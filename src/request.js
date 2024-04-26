const http = require('http');
const stream = require('stream');

async function makeRequest(path, tool, opts = {}) {
	let stdout = '';
	const postData = JSON.stringify({ ...tool, ...opts });
	const options = requestOptions(path, postData, tool, opts);

	const p = new Promise((resolve, reject) => {
		const req = http.request(options, (res) => {
			res.on('data', (chunk) => {
				stdout += chunk;
			});

			res.on('end', () => {
				resolve();
			})
		});

		req.on('error', (error) => {
			reject(`Error making ${options.method} request: ${error.message}`);
		});

		req.write(postData);
		req.end();
	})

	await p;
	const respObj = JSON.parse(stdout);
	if (respObj.error) {
		throw new Error(respObj.error);
	}

	return respObj.output;
}

async function makeStreamRequest(path, tool, opts = {}) {
	const stdout = new stream.Readable({
		encoding: 'utf-8',
		read() {}
	});
	const stderr = new stream.Readable({
		encoding: 'utf-8',
		read() {}
	});

	const postData = JSON.stringify({ ...tool, ...opts });
	const options = requestOptions(path, postData, tool, opts);

	const p = new Promise((resolve, reject) => {
		const req = http.request(options, (res) => {
			res.on('data', (chunk) => {
				const c = chunk.toString().replace(/^(data: )/,"").trim();
				if (c === '[DONE]') {
				} else if (c.startsWith('{"stderr":')) {
					stderr.push(JSON.parse(c).stderr);
				} else {
					stdout.push(JSON.parse(c).stdout);
				}
			});

			res.on('end', () => {
				resolve();
			})
		});

		req.on('error', (error) => {
			reject(`Error making ${options.method} request: ${error.message}`);
		});

		req.write(postData);
		req.end();
	})

	return {
		stdout: stdout,
		stderr: stderr,
		promise: p
	}
}

async function makeStreamRequestWithEvents(path, tool, opts = {}) {
	const stdout = new stream.Readable({
		encoding: 'utf-8',
		read() {}
	});
	const stderr = new stream.Readable({
		encoding: 'utf-8',
		read() {}
	});
	const events = new stream.Readable({
		encoding: 'utf-8',
		read() {}
	});

	const postData = JSON.stringify({ ...tool, ...opts });
	const options = requestOptions(path, postData, tool, opts);

	const p = new Promise((resolve, reject) => {
		const req = http.request(options, (res) => {
			res.on('data', (chunk) => {
				const c = chunk.toString().replace(/^(data: )/,"").trim();
				if (c === '[DONE]') {
				} else if (c.startsWith('{"stderr":')) {
					stderr.push(JSON.parse(c).stderr);
				} else if (c.startsWith('{"stdout":')) {
					stdout.push(JSON.parse(c).stdout);
				} else {
					events.push(c+"\n");
				}
			});

			res.on('end', () => {
				resolve();
			})
		});

		req.on('error', (error) => {
			reject(`Error making ${options.method} request: ${error.message}`);
		});

		req.write(postData);
		req.end();
	})

	return {
		stdout: stdout,
		stderr: stderr,
		events: events,
		promise: p
	}
}

function requestOptions(path, postData, tool, opts = {}) {
	let method = 'GET';
	if (tool) {
		method = 'POST';
	}

	return {
		hostname: process.env['GPTSCRIPT_URL'],
		port: parseInt(process.env['GPTSCRIPT_PORT'] || '8080'),
		protocol: process.env['GPTSCRIPT_PROTOCOL'] || 'http:',
		path: '/' + path,
		method: method,
		headers: {
			'Content-Type': 'application/json',
			'Content-Length': Buffer.byteLength(postData),
		},
	};
}

module.exports = {
	makeStreamRequestWithEvents: makeStreamRequestWithEvents,
	makeStreamRequest: makeStreamRequest,
	makeRequest: makeRequest
}