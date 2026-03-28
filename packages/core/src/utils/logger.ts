import chalk from 'chalk';

const BRAND = chalk.hex('#7C3AED');
const BRAND_BG = chalk.bgHex('#7C3AED').white.bold;
const NAME = BRAND_BG(' ⬡ memoryblock ');

export const log = {
    banner(): void {
        /* eslint-disable no-irregular-whitespace */
        const ascii = `
 █▀▄▀█ █▀▀ █▀▄▀█ █▀█ █▀█ █▄█ █▄▄ █░░ █▀█ █▀▀ █▄▀
 █░▀░█ ██▄ █░▀░█ █▄█ █▀▄ ░█░ █▄█ █▄▄ █▄█ █▄▄ █░█ 
`;
        /* eslint-enable no-irregular-whitespace */
        console.log(chalk.hex('#7C3AED').bold(ascii));
    },
    info(message: string): void {
        console.log(`${chalk.blue('ℹ')} ${message}`);
    },

    success(message: string): void {
        console.log(`${chalk.green('✓')} ${message}`);
    },

    warn(message: string): void {
        console.log(`${chalk.yellow('⚠')} ${message}`);
    },

    error(message: string): void {
        console.error(`${chalk.red('✖')} ${message}`);
    },

    system(blockName: string, message: string): void {
        console.log(`${chalk.gray(`⚙️  [${blockName}]`)} ${message}`);
    },

    monitor(blockName: string, monitorName: string, message: string): void {
        console.log(`${BRAND(`⬡ ${monitorName}`)} ${chalk.gray(`[${blockName}]`)} ${message}`);
    },

    brand(message: string): void {
        console.log(`\n${NAME} ${message}`);
    },

    dim(message: string): void {
        console.log(chalk.dim(message));
    },
};