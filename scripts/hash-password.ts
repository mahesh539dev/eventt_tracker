import readline from 'node:readline';
import { hashPassword } from '../src/auth.js';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Password: ', async (password) => {
  rl.close();
  console.log(await hashPassword(password));
});
