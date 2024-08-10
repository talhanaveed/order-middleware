const { Stack, Duration } = require('aws-cdk-lib');
const lambda = require('aws-cdk-lib/aws-lambda');
const dynamodb = require('aws-cdk-lib/aws-dynamodb');
const cdk = require('aws-cdk-lib');
const path = require('path');
const sns = require('aws-cdk-lib/aws-sns'); // Import the SNS module
const subscriptions = require('aws-cdk-lib/aws-sns-subscriptions');
const sfn = require('aws-cdk-lib/aws-stepfunctions');
const tasks = require('aws-cdk-lib/aws-stepfunctions-tasks');
const events = require('aws-cdk-lib/aws-events');
const targets = require('aws-cdk-lib/aws-events-targets');
const iam = require('aws-cdk-lib/aws-iam');
const apigateway = require('aws-cdk-lib/aws-apigatewayv2');
const apigatewayIntegrations = require('aws-cdk-lib/aws-apigatewayv2-integrations');


class CdkStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);


    const lambdaFunction = new lambda.Function(this, 'WriteLambdaFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, 'function.zip')),
      timeout: Duration.seconds(30),
    });

    const lambdaFunction2 = new lambda.Function(this, 'ReadLambdaFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, 'readfunction.zip')),
      timeout: Duration.seconds(30),
    });

    // Create a DynamoDB table
    const orderTable = new dynamodb.Table(this, 'OrderTable', {
      tableName: 'order',
      partitionKey: { name: 'orderid', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, // On-demand capacity mode
      removalPolicy: cdk.RemovalPolicy.DESTROY, // DELETE the table when the stack is destroyed
    });



    // Create an SNS topic with type 'Standard' and name 'orderConfirmation'
    const orderConfirmationTopic = new sns.Topic(this, 'OrderConfirmationTopic', {
      topicName: 'orderConfirmation',
      displayName: 'Order Confirmation Topic',
      fifo: false,
    });

    // Get the email address from the cdk.json file
    const emailAddress = this.node.tryGetContext('emailAddress');

    // Add an email subscription to the topic using the email address from cdk.json
    if (emailAddress) {
      orderConfirmationTopic.addSubscription(new subscriptions.EmailSubscription(emailAddress));
    } else {
      console.warn('No email address provided in cdk.json. Skipping email subscription.');
    }

      // Create the Step Functions state machine
    const lambdaInvoke = new tasks.LambdaInvoke(this, 'Lambda Invoke', {
      lambdaFunction: lambdaFunction,
      integrationPattern: sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
      payload: sfn.TaskInput.fromObject({
        'Payload': sfn.JsonPath.entirePayload,
        'TaskToken': sfn.JsonPath.taskToken
      }),
      retryOnServiceExceptions: true,
    });

    const notifyFailure = new tasks.SnsPublish(this, 'Notify Failure', {
      topic: orderConfirmationTopic,
      message: sfn.TaskInput.fromText('Task started by Step Functions failed.'),
    });

    const notifySuccess = new tasks.SnsPublish(this, 'Notify Success', {
      topic: orderConfirmationTopic,
      message: sfn.TaskInput.fromText('Callback received. Task started by Step Functions succeeded.'),
    });

    const definition = lambdaInvoke
      .addCatch(notifyFailure)
      .next(notifySuccess);

    const stateMachine = new sfn.StateMachine(this, 'OrderProcessingStateMachine', {
      definition,
      timeout: cdk.Duration.minutes(5),
    });




   // stateMachine.node.addDependency(lambdaFunction);
    
    // Create an EventBridge event bus
    const orderEventBus = new events.EventBus(this, 'OrderEventBus', {
      eventBusName: 'orders'
    });

    // Create the 'newOrder' rule
    const newOrderRule = new events.Rule(this, 'NewOrderRule', {
      eventBus: orderEventBus,
      eventPattern: {
        source: ['apigateway.amazonaws.com'],
        detail: {
          operation: ['create']
        }
      },
      ruleName: 'newOrder'
    });

    // Create the 'updateOrder' rule
    const updateOrderRule = new events.Rule(this, 'UpdateOrderRule', {
      eventBus: orderEventBus,
      eventPattern: {
        source: ['apigateway.amazonaws.com'],
        detail: {
          operation: ['update']
        }
      },
      ruleName: 'updateOrder'
    });



    // Add targets to the rules
    newOrderRule.addTarget(new targets.SfnStateMachine(stateMachine));
    updateOrderRule.addTarget(new targets.LambdaFunction(lambdaFunction));



    // Create the API Gateway HTTP API
    
    const httpApi = new apigateway.HttpApi(this, 'OrdersApi', {
      apiName: 'Orders API',
      createDefaultStage: true,
    });

    // 1. GET /get integration
    const getLambdaIntegration = new apigatewayIntegrations.HttpLambdaIntegration('GetLambdaIntegration', lambdaFunction2);
    httpApi.addRoutes({
      path: '/get',
      methods: [apigateway.HttpMethod.GET],
      integration: getLambdaIntegration,
    });

    // 2 & 3. POST /create and POST /update integrations
    const eventBridgeRole = new iam.Role(this, 'EventBridgeIntegrationRole', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
    });

    eventBridgeRole.addToPolicy(new iam.PolicyStatement({
      actions: ['events:PutEvents'],
      resources: [orderEventBus.eventBusArn],
    }));

    const eventBridgeIntegration = new apigateway.CfnIntegration(this, 'EventBridgeIntegration', {
      apiId: httpApi.apiId,
      integrationType: 'AWS_PROXY',
      integrationSubtype: 'EventBridge-PutEvents',
      credentialsArn: eventBridgeRole.roleArn,
      requestParameters: {
        Source: 'apigateway.amazonaws.com',
        DetailType: 'OrderOperation',
        Detail: '$request.body',
        EventBusName: orderEventBus.eventBusName,
      },
      payloadFormatVersion: '1.0',
      timeoutInMillis: 30000,
    });

    new apigateway.CfnRoute(this, 'CreateOrderRoute', {
      apiId: httpApi.apiId,
      routeKey: 'POST /create',
      target: `integrations/${eventBridgeIntegration.ref}`,
    });

    new apigateway.CfnRoute(this, 'UpdateOrderRoute', {
      apiId: httpApi.apiId,
      routeKey: 'POST /update',
      target: `integrations/${eventBridgeIntegration.ref}`,
    });

    // Output the API URL
    new cdk.CfnOutput(this, 'HttpApiUrl', {
      value: httpApi.url ?? 'Something went wrong with the deploy',
      description: 'HTTP API URL',
    });

    stateMachine.node.addDependency(lambdaFunction);
newOrderRule.node.addDependency(stateMachine);
updateOrderRule.node.addDependency(lambdaFunction);

    // Grant the Lambda function read/write permissions to the DynamoDB table
    orderTable.grantReadWriteData(lambdaFunction);
    orderTable.grantReadWriteData(lambdaFunction2);
    const lambdaRole = lambdaFunction.role;
    if (lambdaRole) {
      lambdaRole.addToPrincipalPolicy(new iam.PolicyStatement({
        actions: [
          'states:SendTaskSuccess',
          'states:SendTaskFailure',
          'states:SendTaskHeartbeat'
        ],
        resources: [`arn:aws:states:${this.region}:${this.account}:stateMachine:*`],
      }));
    }

    lambdaFunction.grantInvoke(stateMachine);
    orderConfirmationTopic.grantPublish(stateMachine);

        // Grant permissions for EventBridge to invoke the targets
    //  stateMachine.grantStartExecution(new iam.ServicePrincipal('events.amazonaws.com'));
    lambdaFunction.grantInvoke(new iam.ServicePrincipal('events.amazonaws.com'));
  }
}

module.exports = { CdkStack }

