#!/usr/bin/env node

'use strict'

const { DownloaderHelper } = require('node-downloader-helper');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const tar = require('tar');

// Existing code...

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
    version: "v0.1.3"
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

const outputDir = path.join(__dirname, '..', 'bin');

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

if (fileExist(path.join(outputDir, gptscriptBinaryName))) {
    console.log('gptscript is already installed')
    process.exit(0)
}

if (process.env.NODE_GPTSCRIPT_SKIP_INSTALL_BINARY === 'true') {
    console.info('Skipping binary download');
    process.exit(0);
}

console.log(`Downloading and extracting gptscript binary from ${url}...`);
downloadAndExtract(url, outputDir)
    .then(() => console.log('Download and extraction completed.'))
    .catch((error) => console.error('Error downloading and extracting:', error));
