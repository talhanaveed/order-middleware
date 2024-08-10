# order-middleware
This project implements the infrastructure and code needed to create a middleware hosted on AWS that can process orders on a massive scale. 
## Architecture
![Alt text](./architecture1.png?raw=true "Architecture")
![Alt text](./architecture2.png?raw=true "Architecture")

In order to deploy the CDK, a few actions first need to be performed.
## Prerequisites
### Clone gitlab repository 
`git clone <git url>`

### Install the required packages
The aws-cli must be installed -and- configured with an AWS account on the deployment machine (see https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-install.html for instructions on how to do this on your preferred development platform).
This project requires [Node.js](http://nodejs.org/). To make sure you have it available on your machine, try running the following command.

```shell
node -v
```

For best experience we recommend installing CDK globally: `npm install -g aws-cdk`

### Configure appropriate options
In the cdk.json, modify the email address as needed. The parameter definition is below.

```markdown
- Required:`emailAddress` The email address that'll subscribe to SNS topic on which the order status is updated.
```
## Deployment
AWS infrastructure needs to be deployed and configured for the experience to function. The required code has been written using CDK and included in the repository. To deploy, perform the following steps:

1. Perform the required steps dictated in the Prerequisites
2. Configure your AWS credentials `aws configure`
3. CD into the code directory
4. Install the required dependencies `npm install`
5. Build the environment `npm run build`
5. CDK bootstrap `cdk bootstrap aws://ACCOUNT-NUMBER/REGION`
6. Deploy the application `cdk deploy --all`

Deployment can take approximately 10 minutes. Once complete, you will need to note down the output of the CDK deployment. The output will look like this: 
`CdkStack.HttpApiUrl = https://<API>.<region>.amazonaws.com/`

1. Navigate to the Cloud Formation console.
2. Get the URL for the API from the Output tab of your stack deployment.

## Usage
Open your API testing platform like Postman. The interaction with this project will be through API calls. Remember to pass two **important** parameters in the body of your requests.
```markdown
- Required:`orderid` The unique identifier of your order. Two orders cannot have the same orderid
- Required in create/update requests:`status` false = order is not accepted, true = order is accepted
```

### Creating an order
You need to make a **POST** call to the following URL:
```shell
https://<API>.<region>.amazonaws.com/create
```
Request parameters:
```markdown
- Required:`orderid` The unique identifier of your order. Two orders cannot have the same orderid
- Required:`status` false = order is not accepted, true = order is accepted
```
In the body of your request, send the following payload:
```shell
"{
    "operation": "create",
    "payload": {
        "orderid": "1",
        "status": false
    }
}"
```
### Get an order
You need to make a **GET** call to the following URL:
```shell
https://<API>.<region>.amazonaws.com/get
```
Request parameters:
```markdown
- Required:`orderid` The unique identifier of your order. Two orders cannot have the same orderid
- Optional:`status` false = order is not accepted, true = order is accepted
```
In the body of your request, send the following payload:
```shell
"{
    "orderid": "1"
}"
```
### Update an order
You need to make a **POST** call to the following URL:
```shell
https://<API>.<region>.amazonaws.com/update
```
Request parameters:
```markdown
- Required:`orderid` The unique identifier of your order. Two orders cannot have the same orderid
- Required:`status` false = order is not accepted, true = order is accepted
```
In the body of your request, send the following payload:
```shell
"{
    "operation": "update",
    "payload": {
        "orderid": "1",
        "status": true
    }
}"
```