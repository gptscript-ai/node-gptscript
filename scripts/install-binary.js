#!/usr/bin/env node

'use strict'

import {DownloaderHelper} from 'node-downloader-helper';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import tar from 'tar';
import util from 'util';
import child_process from 'child_process'

const exec = util.promisify(child_process.exec);

async function downloadAndExtract(url, saveDirectory) {
    const dlh = new DownloaderHelper(url, saveDirectory);

    return new Promise((resolve, reject) => {
        dlh.on('end', () => {
            if (url.endsWith('.zip')) {
                const zip = new AdmZip(path.join(dlh.getDownloadPath()));
                zip.extractAllTo(saveDirectory, true);
            } else if (url.endsWith('.tar.gz')) {
                tar.x({
                    file: path.join(dlh.getDownloadPath()),
                    cwd: saveDirectory,
                });
            }
            resolve();
        });
        dlh.on('error', (error) => reject(error));
        dlh.on('progress.throttled', (downloadEvents) => {
            const percentageComplete =
                downloadEvents.progress < 100
                    ? downloadEvents.progress.toFixed(2)
                    : 100;
            console.info(`downloaded: ${percentageComplete}%`);
        });

        dlh.start();
    });
}

async function versions_match() {
    try {
        const command = path.join(outputDir, gptscriptBinaryName) + ' --version';
        const {stdout} = await exec(command);
        return stdout.toString().includes(gptscript_info.version);
    } catch (err) {
        console.error('Error checking gptscript version:', err);
        return false;
    }
}

const platform = process.platform;
let arch = process.arch;
if (process.platform === 'darwin') {
    arch = 'universal';
} else if (process.arch === 'x64') {
    arch = 'amd64';
}

let gptscriptBinaryName = 'gptscript';
if (process.platform === 'win32') {
    gptscriptBinaryName = 'gptscript.exe';
}

const gptscript_info = {
    name: "gptscript",
    url: "https://github.com/gptscript-ai/gptscript/releases/download/",
    version: "v0.9.2"
}

const pltfm = {
    win32: "windows",
    linux: "linux",
    darwin: "macOS"
}[platform];

const suffix = {
    win32: 'zip',
    linux: 'tar.gz',
    darwin: 'tar.gz'
}[platform];

const url = `${gptscript_info.url}${gptscript_info.version}/gptscript-${gptscript_info.version}-${pltfm}-${arch}.${suffix}`;

const outputDir = path.resolve('bin');

const fileExist = (path) => {
    try {
        fs.accessSync(path);
        return true;
    } catch (err) {
        return false;
    }
}

if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
    console.info(`${outputDir} directory was created`)
}

async function needToInstall() {
    if (fileExist(path.join(outputDir, gptscriptBinaryName))) {
        console.log('gptscript is installed...')
        const versions = await versions_match();
        if (versions) {
            console.log('gptscript version is up to date...exiting')
            process.exit(0);
        }
    }
}

(async () => {
    await needToInstall();
    if (process.env.NODE_GPTSCRIPT_SKIP_INSTALL_BINARY === 'true') {
        console.info('Skipping binary download');
        process.exit(0);
    }

    console.log(`Downloading and extracting gptscript binary from ${url}...`);
    try {
        downloadAndExtract(url, outputDir)
    } catch (error) {
        console.error('Error downloading and extracting:', error)
    }
})();


