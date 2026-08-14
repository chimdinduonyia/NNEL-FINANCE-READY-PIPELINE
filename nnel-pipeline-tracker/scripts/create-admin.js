'use strict';
/**
 * create-admin.js — one-time script to seed the first admin account.
 *
 * Run with:  npm run create-admin
 *
 * You'll be prompted for the admin's full name, email, and password.
 * The password is never shown on screen and never logged.
 */

require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcrypt');
const pool = require('../server/db');

const BCRYPT_ROUNDS = 12; // industry-standard work factor

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

// readline doesn't natively hide input, but this turns off echo for the
// password prompt on most terminals.
function askPassword(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    let password = '';
    process.stdin.on('data', function onData(char) {
      if (char === '\r' || char === '\n') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(password);
      } else if (char === '') {
        process.stdout.write('\n');
        process.exit(1);
      } else if (char === '') {
        // Backspace
        password = password.slice(0, -1);
      } else {
        password += char;
      }
    });
  });
}

async function main() {
  console.log('=== Create NNEL Admin Account ===\n');

  const fullName = (await ask('Full name: ')).trim();
  const email    = (await ask('Email:     ')).trim().toLowerCase();
  const password = await askPassword('Password:  ');
  rl.close();

  if (!fullName || !email || !password) {
    console.error('All fields are required.');
    process.exit(1);
  }
  if (password.length < 12) {
    console.error('Password must be at least 12 characters.');
    process.exit(1);
  }

  // Check if email is already taken
  const [existing] = await pool.execute(
    'SELECT id FROM users WHERE email = ?',
    [email]
  );
  if (existing.length > 0) {
    console.error(`An account with email ${email} already exists.`);
    await pool.end();
    process.exit(1);
  }

  console.log('\nHashing password (this takes a moment)…');
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  await pool.execute(
    `INSERT INTO users (email, full_name, password_hash, system_role)
     VALUES (?, ?, ?, 'admin')`,
    [email, fullName, passwordHash]
  );

  console.log(`\nAdmin account created successfully.`);
  console.log(`  Email:  ${email}`);
  console.log(`  Name:   ${fullName}`);
  console.log(`  Role:   admin\n`);

  await pool.end();
}

main().catch((err) => {
  console.error('Error creating admin:', err.message);
  process.exit(1);
});
