const fs = require('fs');
const async = require('async');
const AWS = require('aws-sdk');
const commandLineArgs = require('command-line-args');
require('exit-code');

const optionDefinitions = [
  { name: 'region', type: String, defaultValue: 'us-east-1' },
  { name: 'description', type: String, defaultValue: 'updates CloudWatch alarm thresholds for DynamoDB tables that are autoscaled'},
  { name: 'profile', type: String, defaultValue: 'default'}
];

const options = commandLineArgs(optionDefinitions);


AWS.config.credentials = new AWS.SharedIniFileCredentials({profile: options.profile});
const cloudwatch = new AWS.CloudWatch({region: options.region});

var updateAlarms = function (table, config) {
  var readAlarmName = table + "-ReadCapacityUnitsLimit-BasicAlarm";
  var writeAlarmName = table + "-WriteCapacityUnitsLimit-BasicAlarm";

  var req = {
    AlarmNames: [readAlarmName, writeAlarmName],
    MaxRecords: 2
  };

  cloudwatch.describeAlarms(req)
  .on('success', function(response){
    alarms = response.data.MetricAlarms;

    /*
     * Get which max value should be used for this specific alarm.
     *
     * DynamoDB normally configures the alarm to be capacity / 60, which is
     * too low for our needs, so we compensate to get the value we want.
     */
    var maxReadCapacity = config.ReadCapacity.Max * 60;
    var maxWriteCapacity = config.WriteCapacity.Max * 60;
    var maxValues = [maxReadCapacity, maxWriteCapacity];

    if (/WriteCapacity/.test(alarms[0].AlarmName)) {
      maxValues = [maxWriteCapacity, maxReadCapacity];
    }

    async.series([
      function(alarmResultCallback) {
        err = updateAlarmFn(alarms[0], maxValues[0]);
        alarmResultCallback(err);
      },
      function(alarmResultCallback) {
        err = updateAlarmFn(alarms[1], maxValues[1]);
        alarmResultCallback(err);
      },
    ],
    function(err, results) {
        //console.log("at the end");
      });
    })
    .on('error', function(response){
      console.log('error getting alarms for ' + table + ': ' + response);
    }).send();
}

var updateAlarmFn = function (alarm, maxValue) {

  var req = {
    AlarmName: alarm.AlarmName,
    AlarmActions: alarm.AlarmActions,
    ComparisonOperator: alarm.ComparisonOperator,
    EvaluationPeriods: alarm.EvaluationPeriods,
    MetricName: alarm.MetricName,
    Namespace: alarm.Namespace,
    Period: alarm.Period,
    Threshold: maxValue,
    Dimensions: alarm.Dimensions,
    Statistic: alarm.Statistic,
    Unit: alarm.Unit
  }

  cloudwatch.putMetricAlarm(req)
  .on('success', function(response) {
    console.log('put alarm ' + alarm['AlarmName']);
    return null;
  })
  .on('error', function(response) {
    console.log('failed to put alarm ' + alarm['AlarmName'] + ' with error: ' + response);
    return response;
  }).send();
}

var globalConfig = JSON.parse(fs.readFileSync('../src/configuration/ShadowProvisioner.json', 'utf8'));

for (index in globalConfig) {
  var tableConfig = globalConfig[index];
  for (tableIndex in tableConfig.tables) {
    var table = tableConfig.tables[tableIndex];
    var config = tableConfig.configuration;
    updateAlarms(table, config);
  }
}
