'use strict';
/**
 * db.js — MariaDB connection pool
 *
 * A pool keeps a set of open connections ready to reuse, rather than
 * opening a fresh TCP connection for every query. mysql2/promise gives
 * us async/await support out of the box.
 *
 * timezone '+00:00' tells the driver to interpret all DATETIME values
 * as UTC on both read and write, matching the CURRENT_TIMESTAMP defaults
 * in the schema.
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:             process.env.DB_HOST     || 'localhost',
  port:             Number(process.env.DB_PORT) || 3306,
  user:             process.env.DB_USER,
  password:         process.env.DB_PASSWORD,
  database:         process.env.DB_NAME,
  timezone:         '+00:00',   // store and read all datetimes as UTC
  waitForConnections: true,
  connectionLimit:  10,
  queueLimit:       0,
});

module.exports = pool;
