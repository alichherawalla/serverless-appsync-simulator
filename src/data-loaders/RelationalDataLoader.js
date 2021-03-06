import Sequelize from 'sequelize';
import get from 'lodash/get';
import Promise from 'bluebird';
import { Pool, Client, types as pgTypes } from 'pg';
import mysql from 'mysql2/promise';
import { Types, Flags } from 'mysql2';
const FLAGS = {
  NOT_NULL: 1,
  PRI_KEY: 2,
  UNIQUE_KEY: 4,
  MULTIPLE_KEY: 8,
  BLOB: 16,
  UNSIGNED: 32,
  ZEROFILL: 64,
  BINARY: 128,
  ENUM: 256,
  AUTO_INCREMENT: 512,
  TIMESTAMP: 1024,
  SET: 2048,
  NO_DEFAULT_VALUE: 4096,
  ON_UPDATE_NOW: 8192,
  NUM: 32768,
};

const decToBin = (dec) => parseInt((dec >>> 0).toString(2), 2);

const convertMySQLResponseToColumnMetaData = (rows) => {
  return rows.map((row) => {
    // @TODO: Add for the following fields
    // arrayBaseColumnType,
    // isCaseSensitive,
    // isCurrency,
    // currency,
    // precision,
    // scale,
    // schemaName,
    return {
      isAutoIncrement:
        decToBin(row.flags & FLAGS.AUTO_INCREMENT) === FLAGS.AUTO_INCREMENT,
      isSigned: decToBin(row.flags & FLAGS.UNSIGNED) !== FLAGS.UNSIGNED,
      label: row.name,
      name: row.name,
      nullable: decToBin(row.flags && FLAGS.NOT_NULL) !== FLAGS.NOT_NULL,
      type: row.columnType,
      typeName: Object.keys(Types).find((key) => Types[key] === row.columnType),
      isSigned: decToBin(row.flags & FLAGS.UNSIGNED) !== FLAGS.UNSIGNED,
      autoIncrement:
        decToBin(row.flags & FLAGS.AUTO_INCREMENT) === FLAGS.AUTO_INCREMENT,
      tableName: row._buf
        .slice(row._tableStart, row._tableStart + row._tableLength)
        .toString(),
    };
  });
};
const convertMySQLResponseToRDSRecords = (rows) => {
  const records = [];

  rows.forEach((dbObject) => {
    const record = [];

    Object.keys(dbObject).forEach((key) => {
      record.push(
        typeof dbObject[key] === 'string'
          ? { stringValue: dbObject[key] }
          : dbObject[key] === 'number'
          ? { longValue: dbObject[key] }
          : { stringValue: dbObject[key] },
      );
    });
    records.push(record);
  });
  return records;
};

const convertPostgresSQLResponseToRDSRecords = (rows) => {
  const records = [];

  rows.forEach((dbObject) => {
    const record = [];

    Object.keys(dbObject).forEach((key) => {
      record.push(
        typeof dbObject[key] === 'string'
          ? { stringValue: dbObject[key] }
          : dbObject[key] === 'number'
          ? { longValue: dbObject[key] }
          : { stringValue: dbObject[key] },
      );
    });
    records.push(record);
  });
  return records;
};
const convertPostgresSQLResponseToColumnMetaData = (rows) => {
  console.log(JSON.stringify(rows));
  return rows.map((row) => {
    const dataType = Object.keys(pgTypes.builtins).find(
      (d) => pgTypes.builtins[d] === row.dataTypeID,
    );
    // @TODO: Add support for the following fields
    // isAutoIncrement,
    // isSigned,
    // nullable,
    // isSigned,
    // autoIncrement,
    // tableName,
    // arrayBaseColumnType,
    // isCaseSensitive,
    // isCurrency,
    // currency,
    // precision,
    // scale,
    // schemaName,
    return {
      label: row.name,
      name: row.name,
      type: row.dataTypeID,
      typeName: dataType,
    };
  });
};

export default class RelationalDataLoader {
  constructor(config) {
    this.config = config;
  }

  async load(req) {
    console.log(JSON.stringify(req));
    try {
      const requiredKeys = [
        'dbDialect',
        'dbUsername',
        'dbPassword',
        'dbHost',
        'dbName',
      ];
      if (!this.config.rds) {
        throw new Error('RDS configuration not passed');
      }
      const missingKey = requiredKeys.find((key) => {
        return !this.config.rds[key];
      });
      if (missingKey) {
        throw new Error(`${missingKey} is required.`);
      }

      const res = {};
      if (this.config.rds.dbDialect === 'mysql') {
        const client = await mysql.createConnection({
          host: this.config.rds.dbHost,
          user: this.config.rds.dbUsername,
          password: this.config.rds.dbPassword,
          database: this.config.rds.dbName,
          port: this.config.rds.dbPort,
        });
        const results = await Promise.mapSeries(req.statements, (statement) =>
          client.query(statement),
        );

        res.sqlStatementResults = results.map((result) => {
          if (result.length < 2) {
            return {};
          }
          if (!result[1]) {
            // not a select query
            return {
              numberOfRecordsUpdated: result[0].affectedRows,
              generatedFields: [],
            };
          }
          return {
            numberOfRecordsUpdated: result[0].length,
            records: convertMySQLResponseToRDSRecords(result[0]),
            columnMetadata: convertMySQLResponseToColumnMetaData(result[1]),
          };
        });
      } else if (this.config.rds.dbDialect === 'postgres') {
        process.env.PGHOST = this.config.rds.dbHost;
        process.env.PGDATABASE = this.config.rds.dbName;
        process.env.PGPASSWORD = this.config.rds.dbPassword;
        process.env.PGUSER = this.config.rds.dbUsername;
        process.env.PGPORT = this.config.rds.dbPort;
        const client = new Client();
        await client.connect();
        const results = await Promise.mapSeries(req.statements, (statement) =>
          client.query(statement),
        );
        res.sqlStatementResults = results.map((result) => {
          return {
            numberOfRecordsUpdated: result.rowCount,
            records: convertPostgresSQLResponseToRDSRecords(result.rows),
            columnMetadata: convertPostgresSQLResponseToColumnMetaData(
              result.fields,
            ),
            generatedFields: [],
          };
        });
      }
      return JSON.stringify(res);
    } catch (e) {
      console.log(e);
      return e;
    }
  }
}
