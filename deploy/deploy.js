const fs = require('fs');
const path = require('path');
const AWS = require('aws-sdk');
const commandLineArgs = require('command-line-args');
require('exit-code');

const optionDefinitions = [
  { name: 'name', type: String },
  { name: 'functionname', type: String, defaultValue: 'index.handler'},
  { name: 'create',  type: Boolean },
  { name: 'region', type: String, defaultValue: 'us-east-1' },
  { name: 'role', type: String, defaultValue: 'DynamoDBLambdaAutoscale'},
  { name: 'timeout', type: String, defaultValue: '5' },
  { name: 'description', type: String, defaultValue: 'Auto scaling DynamoDB tables'},
  { name: 'profile', type: String, defaultValue: 'default'},
  { name: 'event_name', type: String, defaultValue: 'DynamoDBAutoScaleEvent'},
  { name: 'minute_repeat_rate', type: String, defaultValue: '1'}
];

const options = commandLineArgs(optionDefinitions);

if(!options.name || !options.functionname){
  console.log("Can not update without specificy lambda name and export name");
  process.exitCode = 1;
  return
}

AWS.config.credentials = new AWS.SharedIniFileCredentials({profile: options.profile});
const lambda = new AWS.Lambda({region: options.region});
const cloudWatchEvents = new AWS.CloudWatchEvents({region: options.region});
//calls to aws
var getRole = function (callback) {
  //used to get account id
  var sts = new AWS.STS();
  sts.getCallerIdentity({}, function (err, data) {
    if (err) {
      console.log(err);
      callback(err);
    }
    else {
      const accountId = data.Arn.split(':')[4];
      const role = 'arn:aws:iam::' + accountId + ':role/' + options.role;
      callback(null, role);
    }
  });
};

var updateFunction = function (codeData, ruleArn, ruleName, callback) {
  const params = {
    FunctionName: options.name,
    ZipFile: codeData
  };
  lambda.updateFunctionCode(params, function (err, data) {
    if (err) {
      console.log('Error updating function code');
      console.log(err);
      process.exitCode = 3;
      return;
    }
    console.log('Updated code, result is ' + JSON.stringify(data));
    getRole(function (roleErr, role) {
      if (roleErr) {
        console.log(roleErr);
        return;
      }
      const configParams = {
        FunctionName: options.name,
        Handler: options.functionname,
        Role: role,
        Timeout: parseInt(options.timeout),
        Description: options.description
      };
      lambda.updateFunctionConfiguration(configParams, function (updateErr, updateData) {
        if (updateErr) {
          console.log('Error updating function configuration');
          console.log(updateErr);
          process.exitCode = 4;
          return;
        }
        console.log('Updated configuration, result was ' + JSON.stringify(updateData));
        addLambdaToRule(options.name, updateData.FunctionArn, ruleArn, ruleName, callback);
      });
    });
  })
};
var createFunction = function (codeData, ruleArn, ruleName, callback) {
  getRole(function (roleErr, role) {
    if (roleErr) {
      console.log(roleErr);
      process.exitCode = 1;
      callback(roleErr);
      return;
    }
    const params = {
      Code: {
        ZipFile: codeData
      },
      FunctionName: options.name,
      Handler: options.functionname,
      Role: role,
      Runtime: 'nodejs4.3',
      Publish: true,
      Timeout: parseInt(options.timeout)
    };
    lambda.createFunction(params, function (err, data) {
      if (err) {
        console.log('error creating function');
        console.log(err);
        process.exitCode = 2;
        callback(err);
        return;
      }
      console.log(data);
      console.log("Created function");
      addLambdaToRule(options.name, data.FunctionArn, ruleArn, ruleName, callback);
    });
  });
};

var addLambdaToRule = function(lambdaName, lambdaArn, ruleArn, ruleName, callback){
  var addPermissionParams = {
    Action: 'lambda:InvokeFunction',
    FunctionName: lambdaName,
    Principal: 'events.amazonaws.com',
    StatementId: 'LambdaInvokeFromCloudWatchEvent_' + lambdaName + '_' + ruleName,
    SourceArn: ruleArn
  };
  //noinspection JSUnusedLocalSymbols
  lambda.addPermission(addPermissionParams, function (err, data) {
    if(err){
      if(err.Code != 'ResourceConflictException'){
        console.log("Permission was already added");
      } else {
        callback(err);
        return;
      }
    } else {
      console.log("Added permission to lambda");
    }
    var putTargetsParams = {
      Rule: ruleName,
      Targets: [
        {
          Arn: lambdaArn,
          Id: '1',
        }
      ]
    };
    cloudWatchEvents.putTargets(putTargetsParams, function (err, data) {
      if(err){
        console.log("Error putting lambda to cloud watch event target");
        callback(err);
        return
      }
      console.log("Put cloud watch event target to be lambda");
      callback(null, data);
    })
  })
};

var getCloudWatchEventArn = function (ruleName, callback) {
  const params = {
    Name: ruleName
  };
  cloudWatchEvents.describeRule(params, function (err, data) {
    if (err) {
      console.log('Could not get rule named ' + ruleName);
      callback(err);
    } else {
      callback(null, data.RuleArn);
    }
  });
};
var createCloudWatchEvent = function (ruleName, callback) {
  const params = {
    Name: ruleName,
    Description: 'Schedule event for calling the auto scaling lambda function',
    ScheduleExpression: 'rate(' + options.minute_repeat_rate + ' minute)',
    State: 'ENABLED'
  };
  cloudWatchEvents.putRule(params, function (err, data) {
    if(err){
      console.log("Error putting rule " + err);
      callback(err);
      return;
    }
    console.log('Finished creating rule');
    callback(err, data.RuleArn);
  });
};

var fileLocation = path.join(__dirname, "../dist.zip");
fs.readFile(fileLocation, function (err, fileData ) {
  if(err){
    console.log("Could not find file at path " + fileLocation);
    process.exitCode = 2;
    return
  }
  if(options.create){
    createCloudWatchEvent(options.event_name, function (err, ruleArn) {
      createFunction(fileData, ruleArn, options.event_name, function (err, data) {
        if(err){
          console.log(err);
          process.exitCode = 3;
          return;
        }
        console.log(data);
      });
    });
  }
  else{
    getCloudWatchEventArn(options.event_name, function (err, ruleArn) {
      updateFunction(fileData, ruleArn, options.event_name, function (err, data) {
        if(err){
          console.log(err);
          process.exitCode = 3;
          return;
        }
        console.log(data);
      });
    })
  }
});

