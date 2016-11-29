/* @flow */
/* eslint-disable max-len */
import Provisioner from './Provisioner';
import DefaultProvisioner from './configuration/ShadowProvisioner.json';
import type {TableProvisionedAndConsumedThroughput, ProvisionerConfig} from './flow/FlowTypes';
import {log} from './Global';

export default class TableBasedProvisioner extends Provisioner {

  // Gets the list of tables which we want to auto-scale
  async getTableNamesAsync(): Promise<string[]> {
    // Get all tables
    let possibleTables = await this.db.listAllTableNamesAsync();
    // determine what the tables we have definitions for
    let whitelist = this.getTableWhiteList();
    // filter out with a warning if we dont support that table
    return possibleTables.filter(function (name) {
      if (whitelist.indexOf(name) < 0) {
        log('Ignoring table ' + name + ' because it is not in the whitelist');
        return false;
      }
      return true;
    });
  }

  getTableWhiteList(): string[] {
    let results = [];
    for (let i = 0; i < DefaultProvisioner.length; i++) {
      results = results.concat(DefaultProvisioner[i].tables);
    }
    return results;
  }

  // Gets the json settings which control how the specified table will be auto-scaled
  getTableConfig(data: TableProvisionedAndConsumedThroughput): ProvisionerConfig {
    for (let i = 0; i < DefaultProvisioner.length; i++) {
      if (DefaultProvisioner[i].tables.indexOf(data.TableName) >= 0) {
        return DefaultProvisioner[i].configuration;
      }
    }
    log('using default configuration since could not one for table ' + data.TableName);
    throw new ReferenceError('Missing configuration for table name');
  }
}
