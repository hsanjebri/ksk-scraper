import { createInterface } from 'readline';
import { USERNAME_PATTERN } from '../auth-config';
import { hashPassword } from '../password';

/**
 * Prints a DASHBOARD_USERS entry for one person:  name:scrypt$...
 *
 *   npm run auth:hash-password
 *
 * The password is read from the terminal without echo — never pass it as an
 * argument, where it would land in the shell history and the process list.
 * Piped input (two lines: user name, password) is accepted for automation.
 */

const MIN_LENGTH = 12;

async function ask(question: string, hidden: boolean): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY,
  });
  if (hidden && process.stdin.isTTY) {
    // Suppress echo of what is typed after the prompt.
    const write = (rl as unknown as { _writeToOutput: (s: string) => void })
      ._writeToOutput;
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput =
      (s: string) => {
        if (s.startsWith(question)) write.call(rl, s);
      };
  }
  const answer = await new Promise<string>((resolve) =>
    rl.question(question, resolve),
  );
  rl.close();
  if (hidden && process.stdin.isTTY) process.stdout.write('\n');
  return answer;
}

async function main(): Promise<void> {
  const user = (await ask('User name: ', false)).trim().toLowerCase();
  if (!USERNAME_PATTERN.test(user)) {
    console.error('User names are 3–64 characters of a-z 0-9 . _ -');
    process.exitCode = 1;
    return;
  }

  const password = await ask('Password (not shown): ', true);
  const problems: string[] = [];
  if (password.length < MIN_LENGTH)
    problems.push(`shorter than ${MIN_LENGTH} characters`);
  if (password.toLowerCase().includes(user))
    problems.push('contains the user name');
  if (problems.length > 0) {
    console.error(`Refused: the password is ${problems.join(' and ')}.`);
    process.exitCode = 1;
    return;
  }

  if (process.stdin.isTTY) {
    const again = await ask('Repeat password: ', true);
    if (again !== password) {
      console.error('The two passwords differ.');
      process.exitCode = 1;
      return;
    }
  }

  console.log(
    '\nAdd this entry to DASHBOARD_USERS on the server (separate several with ";"):\n',
  );
  console.log(`${user}:${await hashPassword(password)}`);
}

void main();
