(function (global, factory) {
	typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
	typeof define === 'function' && define.amd ? define(['exports'], factory) :
	(global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.zip = {}));
}(this, (function (exports) { 'use strict';

	/*
	 Copyright (c) 2021 Gildas Lormeau. All rights reserved.

	 Redistribution and use in source and binary forms, with or without
	 modification, are permitted provided that the following conditions are met:

	 1. Redistributions of source code must retain the above copyright notice,
	 this list of conditions and the following disclaimer.

	 2. Redistributions in binary form must reproduce the above copyright 
	 notice, this list of conditions and the following disclaimer in 
	 the documentation and/or other materials provided with the distribution.

	 3. The names of the authors may not be used to endorse or promote products
	 derived from this software without specific prior written permission.

	 THIS SOFTWARE IS PROVIDED ``AS IS'' AND ANY EXPRESSED OR IMPLIED WARRANTIES,
	 INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
	 FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL JCRAFT,
	 INC. OR ANY CONTRIBUTORS TO THIS SOFTWARE BE LIABLE FOR ANY DIRECT, INDIRECT,
	 INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
	 LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA,
	 OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
	 LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
	 NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
	 EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
	 */

	const ERR_HTTP_STATUS = "HTTP error ";
	const ERR_HTTP_RANGE = "HTTP Range not supported";
	const TEXT_PLAIN = "text/plain";

	class Stream {

		constructor() {
			this.size = 0;
		}

		init() {
			this.initialized = true;
		}
	}
	class Reader extends Stream {
	}

	class Writer extends Stream {

		writeUint8Array(array) {
			this.size += array.length;
		}
	}

	class TextReader extends Reader {

		constructor(text) {
			super();
			this.blobReader = new BlobReader(new Blob([text], { type: TEXT_PLAIN }));
		}

		init() {
			super.init();
			this.blobReader.init();
			this.size = this.blobReader.size;
		}

		readUint8Array(offset, length) {
			return this.blobReader.readUint8Array(offset, length);
		}
	}

	class TextWriter extends Writer {

		constructor(encoding) {
			super();
			this.encoding = encoding;
			this.blob = new Blob([], { type: TEXT_PLAIN });
		}

		writeUint8Array(array) {
			super.writeUint8Array(array);
			this.blob = new Blob([this.blob, array.buffer], { type: TEXT_PLAIN });
		}

		getData() {
			const reader = new FileReader();
			return new Promise((resolve, reject) => {
				reader.onload = event => resolve(event.target.result);
				reader.onerror = reject;
				reader.readAsText(this.blob, this.encoding);
			});
		}
	}

	class Data64URIReader extends Reader {

		constructor(dataURI) {
			super();
			this.dataURI = dataURI;
			let dataEnd = dataURI.length;
			while (dataURI.charAt(dataEnd - 1) == "=") {
				dataEnd--;
			}
			this.dataStart = dataURI.indexOf(",") + 1;
			this.size = Math.floor((dataEnd - this.dataStart) * 0.75);
		}

		readUint8Array(offset, length) {
			const dataArray = new Uint8Array(length);
			const start = Math.floor(offset / 3) * 4;
			const bytes = atob(this.dataURI.substring(start + this.dataStart, Math.ceil((offset + length) / 3) * 4 + this.dataStart));
			const delta = offset - Math.floor(start / 4) * 3;
			for (let indexByte = delta; indexByte < delta + length; indexByte++) {
				dataArray[indexByte - delta] = bytes.charCodeAt(indexByte);
			}
			return dataArray;
		}
	}

	class Data64URIWriter extends Writer {

		constructor(contentType) {
			super();
			this.data = "data:" + (contentType || "") + ";base64,";
			this.pending = [];
		}

		writeUint8Array(array) {
			super.writeUint8Array(array);
			let indexArray = 0, dataString = this.pending;
			const delta = this.pending.length;
			this.pending = "";
			for (indexArray = 0; indexArray < (Math.floor((delta + array.length) / 3) * 3) - delta; indexArray++) {
				dataString += String.fromCharCode(array[indexArray]);
			}
			for (; indexArray < array.length; indexArray++) {
				this.pending += String.fromCharCode(array[indexArray]);
			}
			if (dataString.length > 2) {
				this.data += btoa(dataString);
			} else {
				this.pending = dataString;
			}
		}

		getData() {
			return this.data + btoa(this.pending);
		}
	}

	class BlobReader extends Reader {

		constructor(blob) {
			super();
			this.blob = blob;
			this.size = blob.size;
		}

		readUint8Array(offset, length) {
			const reader = new FileReader();
			return new Promise((resolve, reject) => {
				reader.onload = event => resolve(new Uint8Array(event.target.result));
				reader.onerror = reject;
				reader.readAsArrayBuffer(this.blob.slice(offset, offset + length));
			});
		}
	}

	class BlobWriter extends Writer {

		constructor(contentType) {
			super();
			this.offset = 0;
			this.contentType = contentType;
			this.blob = new Blob([], { type: contentType });
		}

		writeUint8Array(array) {
			super.writeUint8Array(array);
			this.blob = new Blob([this.blob, array.buffer], { type: this.contentType });
			this.offset = this.blob.size;
		}

		getData() {
			return this.blob;
		}
	}

	class HttpReader extends Reader {

		constructor(url) {
			super();
			this.url = url;
		}

		async init() {
			super.init();
			if (isHttpFamily(this.url)) {
				return new Promise((resolve, reject) => {
					const request = new XMLHttpRequest();
					request.addEventListener("load", () => {
						if (request.status < 400) {
							this.size = Number(request.getResponseHeader("Content-Length"));
							if (!this.size) {
								getData().then(() => resolve()).catch(reject);
							} else {
								resolve();
							}
						} else {
							reject(ERR_HTTP_STATUS + (request.statusText || request.status) + ".");
						}
					}, false);
					request.addEventListener("error", reject, false);
					request.open("HEAD", this.url);
					request.send();
				});
			} else {
				await getData();
			}
		}

		async readUint8Array(index, length) {
			if (!this.data) {
				await getData(this, this.url);
			}
			return new Uint8Array(this.data.subarray(index, index + length));
		}
	}

	class HttpRangeReader extends Reader {

		constructor(url) {
			super();
			this.url = url;
		}

		init() {
			super.init();
			return new Promise((resolve, reject) => {
				const request = new XMLHttpRequest();
				request.addEventListener("load", () => {
					if (request.status < 400) {
						this.size = Number(request.getResponseHeader("Content-Length"));
						if (request.getResponseHeader("Accept-Ranges") == "bytes") {
							resolve();
						} else {
							reject(new Error(ERR_HTTP_RANGE));
						}
					} else {
						reject(ERR_HTTP_STATUS + (request.statusText || request.status) + ".");
					}
				}, false);
				request.addEventListener("error", reject, false);
				request.open("HEAD", this.url);
				request.send();
			});
		}

		readUint8Array(index, length) {
			return new Promise((resolve, reject) => {
				const request = new XMLHttpRequest();
				request.open("GET", this.url);
				request.responseType = "arraybuffer";
				request.setRequestHeader("Range", "bytes=" + index + "-" + (index + length - 1));
				request.addEventListener("load", () => {
					if (request.status < 400) {
						resolve(new Uint8Array(request.response));
					} else {
						reject(ERR_HTTP_STATUS + (request.statusText || request.status) + ".");
					}
				}, false);
				request.addEventListener("error", reject, false);
				request.send();
			});
		}
	}

	class Uint8ArrayReader extends Reader {

		constructor(array) {
			super();
			this.array = array;
			this.size = array.length;
		}

		readUint8Array(index, length) {
			return this.array.slice(index, index + length);
		}
	}

	class Uint8ArrayWriter extends Writer {

		constructor() {
			super();
			this.array = new Uint8Array(0);
		}

		writeUint8Array(array) {
			super.writeUint8Array(array);
			const previousArray = this.array;
			this.array = new Uint8Array(previousArray.length + array.length);
			this.array.set(previousArray);
			this.array.set(array, previousArray.length);
		}

		getData() {
			return this.array;
		}
	}

	function isHttpFamily(url) {
		if (typeof document != "undefined") {
			const anchor = document.createElement("a");
			anchor.href = url;
			return anchor.protocol == "http:" || anchor.protocol == "https:";
		} else {
			return /^https?:\/\//i.test(url);
		}
	}

	function getData(httpReader, url) {
		return new Promise((resolve, reject) => {
			const request = new XMLHttpRequest();
			request.addEventListener("load", () => {
				if (request.status < 400) {
					if (!httpReader.size) {
						httpReader.size = Number(request.getResponseHeader("Content-Length")) || Number(request.response.byteLength);
					}
					httpReader.data = new Uint8Array(request.response);
					resolve();
				} else {
					reject(ERR_HTTP_STATUS + (request.statusText || request.status) + ".");
				}
			}, false);
			request.addEventListener("error", reject, false);
			request.open("GET", url);
			request.responseType = "arraybuffer";
			request.send();
		});
	}

	/*
	 Copyright (c) 2021 Gildas Lormeau. All rights reserved.

	 Redistribution and use in source and binary forms, with or without
	 modification, are permitted provided that the following conditions are met:

	 1. Redistributions of source code must retain the above copyright notice,
	 this list of conditions and the following disclaimer.

	 2. Redistributions in binary form must reproduce the above copyright 
	 notice, this list of conditions and the following disclaimer in 
	 the documentation and/or other materials provided with the distribution.

	 3. The names of the authors may not be used to endorse or promote products
	 derived from this software without specific prior written permission.

	 THIS SOFTWARE IS PROVIDED ``AS IS'' AND ANY EXPRESSED OR IMPLIED WARRANTIES,
	 INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
	 FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL JCRAFT,
	 INC. OR ANY CONTRIBUTORS TO THIS SOFTWARE BE LIABLE FOR ANY DIRECT, INDIRECT,
	 INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
	 LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA,
	 OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
	 LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
	 NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
	 EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
	 */

	class Crc32 {

		constructor() {
			this.crc = -1;
			this.table = (() => {
				const table = [];
				for (let i = 0; i < 256; i++) {
					let t = i;
					for (let j = 0; j < 8; j++) {
						if (t & 1) {
							t = (t >>> 1) ^ 0xEDB88320;
						} else {
							t = t >>> 1;
						}
					}
					table[i] = t;
				}
				return table;
			})();
		}

		append(data) {
			const table = this.table;
			let crc = this.crc | 0;
			for (let offset = 0, length = data.length | 0; offset < length; offset++) {
				crc = (crc >>> 8) ^ table[(crc ^ data[offset]) & 0xFF];
			}
			this.crc = crc;
		}

		get() {
			return ~this.crc;
		}
	}

	/*
	 Copyright (c) 2021 Gildas Lormeau. All rights reserved.

	 Redistribution and use in source and binary forms, with or without
	 modification, are permitted provided that the following conditions are met:

	 1. Redistributions of source code must retain the above copyright notice,
	 this list of conditions and the following disclaimer.

	 2. Redistributions in binary form must reproduce the above copyright 
	 notice, this list of conditions and the following disclaimer in 
	 the documentation and/or other materials provided with the distribution.

	 3. The names of the authors may not be used to endorse or promote products
	 derived from this software without specific prior written permission.

	 THIS SOFTWARE IS PROVIDED ``AS IS'' AND ANY EXPRESSED OR IMPLIED WARRANTIES,
	 INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
	 FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL JCRAFT,
	 INC. OR ANY CONTRIBUTORS TO THIS SOFTWARE BE LIABLE FOR ANY DIRECT, INDIRECT,
	 INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
	 LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA,
	 OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
	 LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
	 NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
	 EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
	 */

	const ERR_INVALID_PASSORD = "Invalid pasword";
	const BLOCK_LENGTH = 16;
	const RAW_FORMAT = "raw";
	const PBKDF2_ALGORITHM = { name: "PBKDF2" };
	const SIGNATURE_ALGORITHM = { name: "HMAC" };
	const HASH_FUNCTION = "SHA-1";
	const CRYPTO_KEY_ALGORITHM = { name: "AES-CTR" };
	const BASE_KEY_ALGORITHM = Object.assign({ hash: SIGNATURE_ALGORITHM }, PBKDF2_ALGORITHM);
	const DERIVED_BITS_ALGORITHM = Object.assign({ iterations: 1000, hash: { name: HASH_FUNCTION } }, PBKDF2_ALGORITHM);
	const AUTHENTICATION_ALGORITHM = Object.assign({ hash: HASH_FUNCTION }, SIGNATURE_ALGORITHM);
	const CRYPTO_ALGORITHM = Object.assign({ length: BLOCK_LENGTH }, CRYPTO_KEY_ALGORITHM);
	const DERIVED_BITS_USAGE = ["deriveBits"];
	const SIGN_USAGE = ["sign"];
	const DERIVED_BITS_LENGTH = 528;
	const PREAMBULE_LENGTH = 18;
	const SIGNATURE_LENGTH = 10;
	const COUNTER_DEFAULT_VALUE = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
	const subtle = crypto.subtle;

	class ZipDecrypt {

		constructor(password, signed) {
			this.password = password;
			this.signed = signed;
			this.input = signed && new Uint8Array(0);
			this.pendingInput = new Uint8Array(0);
		}

		async append(input) {
			const decrypt = async (offset = 0) => {
				if (offset + BLOCK_LENGTH <= buferredInput.length - SIGNATURE_LENGTH) {
					const chunkToDecrypt = buferredInput.subarray(offset, offset + BLOCK_LENGTH);
					const outputChunk = await subtle.decrypt(Object.assign({ counter: this.counter }, CRYPTO_ALGORITHM), this.keys.decrypt, chunkToDecrypt);
					incrementCounter(this.counter);
					output.set(new Uint8Array(outputChunk), offset);
					return decrypt(offset + BLOCK_LENGTH);
				} else {
					this.pendingInput = buferredInput.subarray(offset);
					if (this.signed) {
						this.input = concat(this.input, input);
					}
					return output;
				}
			};

			if (this.password) {
				const preambule = input.subarray(0, PREAMBULE_LENGTH);
				await createDecryptionKeys(this, preambule, this.password);
				this.password = null;
				input = input.subarray(PREAMBULE_LENGTH);
			}
			let output = new Uint8Array(input.length - SIGNATURE_LENGTH - ((input.length - SIGNATURE_LENGTH) % BLOCK_LENGTH));
			let buferredInput = input;
			if (this.pendingInput.length) {
				buferredInput = concat(this.pendingInput, input);
				output = expand(output, buferredInput.length - SIGNATURE_LENGTH - ((buferredInput.length - SIGNATURE_LENGTH) % BLOCK_LENGTH));
			}
			return decrypt();
		}

		async flush() {
			const pendingInput = this.pendingInput;
			const keys = this.keys;
			const chunkToDecrypt = pendingInput.subarray(0, pendingInput.length - SIGNATURE_LENGTH);
			const originalSignatureArray = pendingInput.subarray(pendingInput.length - SIGNATURE_LENGTH);
			let decryptedChunkArray = new Uint8Array(0);
			if (chunkToDecrypt.length) {
				const decryptedChunk = await subtle.decrypt(Object.assign({ counter: this.counter }, CRYPTO_ALGORITHM), keys.decrypt, chunkToDecrypt);
				decryptedChunkArray = new Uint8Array(decryptedChunk);
			}
			let valid = true;
			if (this.signed) {
				const signature = await subtle.sign(SIGNATURE_ALGORITHM, keys.authentication, this.input.subarray(0, this.input.length - SIGNATURE_LENGTH));
				const signatureArray = new Uint8Array(signature);
				this.input = null;
				for (let indexSignature = 0; indexSignature < SIGNATURE_LENGTH; indexSignature++) {
					if (signatureArray[indexSignature] != originalSignatureArray[indexSignature]) {
						valid = false;
					}
				}
			}
			return {
				valid,
				data: decryptedChunkArray
			};
		}

	}

	class ZipEncrypt {

		constructor(password) {
			this.password = password;
			this.output = new Uint8Array(0);
			this.pendingInput = new Uint8Array(0);
		}

		async append(input) {
			const encrypt = async (offset = 0) => {
				if (offset + BLOCK_LENGTH <= input.length) {
					const chunkToEncrypt = input.subarray(offset, offset + BLOCK_LENGTH);
					const outputChunk = await subtle.encrypt(Object.assign({ counter: this.counter }, CRYPTO_ALGORITHM), this.keys.encrypt, chunkToEncrypt);
					incrementCounter(this.counter);
					output.set(new Uint8Array(outputChunk), offset + preambule.length);
					return encrypt(offset + BLOCK_LENGTH);
				} else {
					this.pendingInput = input.subarray(offset);
					this.output = concat(this.output, output);
					return output;
				}
			};

			let preambule = new Uint8Array(0);
			if (this.password) {
				preambule = await createEncryptionKeys(this, this.password);
				this.password = null;
			}
			let output = new Uint8Array(preambule.length + input.length - (input.length % BLOCK_LENGTH));
			output.set(preambule, 0);
			if (this.pendingInput.length) {
				input = concat(this.pendingInput, input);
				output = expand(output, input.length - (input.length % BLOCK_LENGTH));
			}
			return encrypt();
		}

		async flush() {
			let encryptedChunkArray = new Uint8Array(0);
			if (this.pendingInput.length) {
				const encryptedChunk = await subtle.encrypt(Object.assign({ counter: this.counter }, CRYPTO_ALGORITHM), this.keys.encrypt, this.pendingInput);
				encryptedChunkArray = new Uint8Array(encryptedChunk);
				this.output = concat(this.output, encryptedChunkArray);
			}
			const signature = await subtle.sign(SIGNATURE_ALGORITHM, this.keys.authentication, this.output.subarray(PREAMBULE_LENGTH));
			this.output = null;
			const signatureArray = new Uint8Array(signature).subarray(0, SIGNATURE_LENGTH);
			return {
				data: concat(encryptedChunkArray, signatureArray),
				signature: signatureArray
			};
		}
	}

	async function createDecryptionKeys(decrypt, preambuleArray, password) {
		decrypt.counter = new Uint8Array(COUNTER_DEFAULT_VALUE);
		const salt = preambuleArray.subarray(0, 16);
		const passwordVerification = preambuleArray.subarray(16);
		const encodedPassword = (new TextEncoder()).encode(password);
		const basekey = await subtle.importKey(RAW_FORMAT, encodedPassword, BASE_KEY_ALGORITHM, false, DERIVED_BITS_USAGE);
		const derivedBits = await subtle.deriveBits(Object.assign({ salt }, DERIVED_BITS_ALGORITHM), basekey, DERIVED_BITS_LENGTH);
		const compositeKey = new Uint8Array(derivedBits);
		const passwordVerificationKey = compositeKey.subarray(64);
		decrypt.keys = {
			decrypt: await subtle.importKey(RAW_FORMAT, compositeKey.subarray(0, 32), CRYPTO_KEY_ALGORITHM, true, ["decrypt"]),
			authentication: await subtle.importKey(RAW_FORMAT, compositeKey.subarray(32, 64), AUTHENTICATION_ALGORITHM, false, SIGN_USAGE),
			passwordVerification: passwordVerificationKey
		};
		if (passwordVerificationKey[0] != passwordVerification[0] || passwordVerificationKey[1] != passwordVerification[1]) {
			throw new Error(ERR_INVALID_PASSORD);
		}
	}

	async function createEncryptionKeys(encrypt, password) {
		encrypt.counter = new Uint8Array(COUNTER_DEFAULT_VALUE);
		const salt = crypto.getRandomValues(new Uint8Array(16));
		const encodedPassword = (new TextEncoder()).encode(password);
		const basekey = await subtle.importKey(RAW_FORMAT, encodedPassword, BASE_KEY_ALGORITHM, false, DERIVED_BITS_USAGE);
		const derivedBits = await subtle.deriveBits(Object.assign({ salt }, DERIVED_BITS_ALGORITHM), basekey, DERIVED_BITS_LENGTH);
		const compositeKey = new Uint8Array(derivedBits);
		encrypt.keys = {
			encrypt: await subtle.importKey(RAW_FORMAT, compositeKey.subarray(0, 32), CRYPTO_KEY_ALGORITHM, true, ["encrypt"]),
			authentication: await subtle.importKey(RAW_FORMAT, compositeKey.subarray(32, 64), AUTHENTICATION_ALGORITHM, false, SIGN_USAGE),
			passwordVerification: compositeKey.subarray(64)
		};
		return concat(salt, encrypt.keys.passwordVerification);
	}

	function incrementCounter(counter) {
		for (let indexCounter = 0; indexCounter < 16; indexCounter++) {
			if (counter[indexCounter] == 255) {
				counter[indexCounter] = 0;
			} else {
				counter[indexCounter]++;
				break;
			}
		}
	}

	function concat(leftArray, rightArray) {
		let array = leftArray;
		if (leftArray.length + rightArray.length) {
			array = new Uint8Array(leftArray.length + rightArray.length);
			array.set(leftArray, 0);
			array.set(rightArray, leftArray.length);
		}
		return array;
	}

	function expand(inputArray, length) {
		if (length && length > inputArray.length) {
			const array = inputArray;
			inputArray = new Uint8Array(length);
			inputArray.set(array, 0);
		}
		return inputArray;
	}

	/*
	 Copyright (c) 2021 Gildas Lormeau. All rights reserved.

	 Redistribution and use in source and binary forms, with or without
	 modification, are permitted provided that the following conditions are met:

	 1. Redistributions of source code must retain the above copyright notice,
	 this list of conditions and the following disclaimer.

	 2. Redistributions in binary form must reproduce the above copyright 
	 notice, this list of conditions and the following disclaimer in 
	 the documentation and/or other materials provided with the distribution.

	 3. The names of the authors may not be used to endorse or promote products
	 derived from this software without specific prior written permission.

	 THIS SOFTWARE IS PROVIDED ``AS IS'' AND ANY EXPRESSED OR IMPLIED WARRANTIES,
	 INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
	 FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL JCRAFT,
	 INC. OR ANY CONTRIBUTORS TO THIS SOFTWARE BE LIABLE FOR ANY DIRECT, INDIRECT,
	 INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
	 LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA,
	 OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
	 LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
	 NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
	 EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
	 */

	const MESSAGE_INIT = "init";
	const MESSAGE_APPEND = "append";
	const MESSAGE_FLUSH = "flush";
	const MESSAGE_EVENT_TYPE = "message";

	const Z_WORKER_SCRIPT_PATH = "z-worker.js";
	const DEFAULT_WORKER_SCRIPTS = {
		deflate: [Z_WORKER_SCRIPT_PATH, "deflate.js"],
		inflate: [Z_WORKER_SCRIPT_PATH, "inflate.js"]
	};
	const workers = {
		pool: [],
		pendingRequests: []
	};

	function createWorkerCodec(config, options) {
		const pool = workers.pool;
		const codecType = options.codecType;
		if (config.workerScripts != null && config.workerScriptsPath != null) {
			throw new Error("Either workerScripts or workerScriptsPath may be set, not both");
		}
		let scripts;
		if (config.workerScripts) {
			scripts = config.workerScripts[codecType];
			if (!Array.isArray(scripts)) {
				throw new Error("workerScripts." + codecType + " must be an array");
			}
			scripts = resolveURLs(scripts);
		} else {
			scripts = DEFAULT_WORKER_SCRIPTS[codecType].slice(0);
			scripts[0] = (config.workerScriptsPath || "") + scripts[0];
		}
		if (pool.length < config.maxWorkers) {
			const workerData = { worker: new Worker(scripts[0]), busy: true, options, scripts };
			pool.push(workerData);
			createWorkerInterface(workerData);
			return workerData.interface;
		} else {
			const availableWorkerData = pool.find(workerData => !workerData.busy);
			if (availableWorkerData) {
				availableWorkerData.busy = true;
				availableWorkerData.options = options;
				availableWorkerData.scripts = scripts;
				return availableWorkerData.interface;
			} else {
				return new Promise(resolve => workers.pendingRequests.push({ resolve, options, scripts }));
			}
		}
	}

	function createWorkerInterface(workerData) {
		const worker = workerData.worker;
		const scripts = workerData.scripts.slice(1);
		let task;
		worker.addEventListener(MESSAGE_EVENT_TYPE, onMessage, false);
		workerData.interface = {
			async append(data) {
				return initAndSendMessage({ type: MESSAGE_APPEND, data });
			},
			async flush() {
				return initAndSendMessage({ type: MESSAGE_FLUSH });
			}
		};

		async function initAndSendMessage(message) {
			if (!task) {
				await sendMessage(Object.assign({ type: MESSAGE_INIT, options: workerData.options, scripts }));
			}
			return sendMessage(message);
		}

		function sendMessage(message) {
			try {
				if (message.data) {
					try {
						worker.postMessage(message, [message.data.buffer]);
					} catch (error) {
						worker.postMessage(message);
					}
				} else {
					worker.postMessage(message);
				}
			} catch (error) {
				task.reject(error);
				worker.removeEventListener(MESSAGE_EVENT_TYPE, onMessage, false);
			}
			return new Promise((resolve, reject) => task = { resolve, reject });
		}

		function onMessage(event) {
			const message = event.data;
			if (task) {
				const reponseError = message.error;
				if (reponseError) {
					const error = new Error(reponseError.message);
					error.stack = reponseError.stack;
					task.reject(error);
					worker.removeEventListener(MESSAGE_EVENT_TYPE, onMessage, false);
				} else if (message.type == MESSAGE_INIT || message.type == MESSAGE_FLUSH || message.type == MESSAGE_APPEND) {
					if (message.type == MESSAGE_FLUSH) {
						task.resolve({ data: new Uint8Array(message.data), signature: message.signature });
						task = null;
						terminateWorker(workerData);
					} else {
						task.resolve(message.data && new Uint8Array(message.data));
					}
				}
			}
		}
	}

	function terminateWorker(workerData) {
		workerData.busy = false;
		if (workers.pendingRequests.length) {
			const [{ resolve, options, scripts }] = workers.pendingRequests.splice(0, 1);
			workerData.busy = true;
			workerData.options = options;
			workerData.scripts = scripts;
			resolve(workerData.interface);
		} else {
			workerData.worker.terminate();
			workers.pool = workers.pool.filter(data => data != workerData);
		}
	}

	function resolveURLs(urls) {
		if (typeof document != "undefined") {
			return urls.map(url => new URL(url, document.baseURI).href);
		} else {
			return urls;
		}
	}

	/*
	 Copyright (c) 2021 Gildas Lormeau. All rights reserved.

	 Redistribution and use in source and binary forms, with or without
	 modification, are permitted provided that the following conditions are met:

	 1. Redistributions of source code must retain the above copyright notice,
	 this list of conditions and the following disclaimer.

	 2. Redistributions in binary form must reproduce the above copyright 
	 notice, this list of conditions and the following disclaimer in 
	 the documentation and/or other materials provided with the distribution.

	 3. The names of the authors may not be used to endorse or promote products
	 derived from this software without specific prior written permission.

	 THIS SOFTWARE IS PROVIDED ``AS IS'' AND ANY EXPRESSED OR IMPLIED WARRANTIES,
	 INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
	 FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL JCRAFT,
	 INC. OR ANY CONTRIBUTORS TO THIS SOFTWARE BE LIABLE FOR ANY DIRECT, INDIRECT,
	 INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
	 LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA,
	 OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
	 LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
	 NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
	 EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
	 */

	const CODEC_DEFLATE = "deflate";
	const CODEC_INFLATE = "inflate";
	const ERR_INVALID_SIGNATURE = "Invalid signature";

	class Inflate {

		constructor(options) {
			this.signature = options.inputSignature;
			this.encrypted = Boolean(options.inputPassword);
			this.signed = options.inputSigned;
			this.compressed = options.inputCompressed;
			this.inflate = this.compressed && new ZipInflate();
			this.crc32 = this.signed && this.signed && new Crc32();
			this.decrypt = this.encrypted && new ZipDecrypt(options.inputPassword);
		}

		async append(data) {
			if (this.encrypted) {
				data = await this.decrypt.append(data);
			}
			if (this.compressed && data.length) {
				data = await this.inflate.append(data);
			}
			if (!this.encrypted && this.signed) {
				this.crc32.append(data);
			}
			return data;
		}

		async flush() {
			let signature, data = new Uint8Array(0);
			if (this.encrypted) {
				const result = await this.decrypt.flush();
				if (!result.valid) {
					throw new Error(ERR_INVALID_SIGNATURE);
				}
				data = result.data;
			} else if (this.signed) {
				const dataViewSignature = new DataView(new Uint8Array(4).buffer);
				signature = this.crc32.get();
				dataViewSignature.setUint32(0, signature);
				if (this.signature != dataViewSignature.getUint32(0, false)) {
					throw new Error(ERR_INVALID_SIGNATURE);
				}
			}
			if (this.compressed) {
				data = (await this.inflate.append(data)) || new Uint8Array(0);
				await this.inflate.flush();
			}
			return { data, signature };
		}
	}

	class Deflate {

		constructor(options) {
			this.encrypted = options.outputEncrypted;
			this.signed = options.outputSigned;
			this.compressed = options.outputCompressed;
			this.deflate = this.compressed && new ZipDeflate({ level: options.level || 5 });
			this.crc32 = this.signed && new Crc32();
			this.encrypt = this.encrypted && new ZipEncrypt(options.outputPassword);
		}

		async append(inputData) {
			let data = inputData;
			if (this.compressed && inputData.length) {
				data = await this.deflate.append(inputData);
			}
			if (this.encrypted) {
				data = await this.encrypt.append(data);
			} else if (this.signed) {
				this.crc32.append(inputData);
			}
			return data;
		}

		async flush() {
			let data = new Uint8Array(0), signature;
			if (this.compressed) {
				data = (await this.deflate.flush()) || new Uint8Array(0);
			}
			if (this.encrypted) {
				data = await this.encrypt.append(data);
				const result = await this.encrypt.flush();
				signature = result.signature;
				const newData = new Uint8Array(data.length + result.data.length);
				newData.set(data, 0);
				newData.set(result.data, data.length);
				data = newData;
			} else if (this.signed) {
				signature = this.crc32.get();
			}
			return { data, signature };
		}
	}

	async function createBaseCodec(options) {
		if (options.codecType.startsWith(CODEC_DEFLATE)) {
			return new Deflate(options);
		} else if (options.codecType.startsWith(CODEC_INFLATE)) {
			return new Inflate(options);
		}
	}

	async function createCodec(config, options) {
		const streamCopy =
			!options.inputCompressed && !options.inputSigned && !options.inputEncrypted &&
			!options.outputCompressed && !options.outputSigned && !options.outputEncrypted;
		if (config.useWebWorkers && !streamCopy) {
			return createWorkerCodec(config, options);
		} else {
			return createBaseCodec(options);
		}
	}

	/*
	 Copyright (c) 2021 Gildas Lormeau. All rights reserved.

	 Redistribution and use in source and binary forms, with or without
	 modification, are permitted provided that the following conditions are met:

	 1. Redistributions of source code must retain the above copyright notice,
	 this list of conditions and the following disclaimer.

	 2. Redistributions in binary form must reproduce the above copyright 
	 notice, this list of conditions and the following disclaimer in 
	 the documentation and/or other materials provided with the distribution.

	 3. The names of the authors may not be used to endorse or promote products
	 derived from this software without specific prior written permission.

	 THIS SOFTWARE IS PROVIDED ``AS IS'' AND ANY EXPRESSED OR IMPLIED WARRANTIES,
	 INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
	 FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL JCRAFT,
	 INC. OR ANY CONTRIBUTORS TO THIS SOFTWARE BE LIABLE FOR ANY DIRECT, INDIRECT,
	 INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
	 LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA,
	 OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
	 LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
	 NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
	 EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
	 */

	const MINIMUM_CHUNK_SIZE = 64;

	async function processData(codec, reader, writer, offset, inputLength, config, options) {
		const chunkSize = Math.max(config.chunkSize, MINIMUM_CHUNK_SIZE);
		return processChunk();

		async function processChunk(chunkIndex = 0, length = 0) {
			const chunkOffset = chunkIndex * chunkSize;
			if (chunkOffset < inputLength) {
				const inputData = await reader.readUint8Array(chunkOffset + offset, Math.min(chunkSize, inputLength - chunkOffset));
				const data = await codec.append(inputData);
				length += await writeData(writer, data);
				if (options.onprogress) {
					options.onprogress(chunkOffset + inputData.length, inputLength);
				}
				return processChunk(chunkIndex + 1, length);
			} else {
				const result = await codec.flush();
				length += await writeData(writer, result.data);
				return { signature: result.signature, length };
			}
		}
	}

	async function writeData(writer, data) {
		if (data.length) {
			await writer.writeUint8Array(data);
		}
		return data.length;
	}

	/*
	 Copyright (c) 2021 Gildas Lormeau. All rights reserved.

	 Redistribution and use in source and binary forms, with or without
	 modification, are permitted provided that the following conditions are met:

	 1. Redistributions of source code must retain the above copyright notice,
	 this list of conditions and the following disclaimer.

	 2. Redistributions in binary form must reproduce the above copyright 
	 notice, this list of conditions and the following disclaimer in 
	 the documentation and/or other materials provided with the distribution.

	 3. The names of the authors may not be used to endorse or promote products
	 derived from this software without specific prior written permission.

	 THIS SOFTWARE IS PROVIDED ``AS IS'' AND ANY EXPRESSED OR IMPLIED WARRANTIES,
	 INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
	 FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL JCRAFT,
	 INC. OR ANY CONTRIBUTORS TO THIS SOFTWARE BE LIABLE FOR ANY DIRECT, INDIRECT,
	 INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
	 LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA,
	 OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
	 LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
	 NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
	 EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
	 */

	const ERR_BAD_FORMAT = "File format is not recognized";
	const ERR_EOCDR_NOT_FOUND = "End of central directory not found";
	const ERR_EOCDR_ZIP64_NOT_FOUND = "End of Zip64 central directory not found";
	const ERR_EOCDR_LOCATOR_ZIP64_NOT_FOUND = "End of Zip64 central directory locator not found";
	const ERR_CENTRAL_DIRECTORY_NOT_FOUND = "Central directory header not found";
	const ERR_LOCAL_FILE_HEADER_NOT_FOUND = "Local file header not found";
	const ERR_EXTRA_FIELD_ZIP64_NOT_FOUND = "Zip64 extra field not found";
	const ERR_ENCRYPTED = "File contains encrypted entry";
	const ERR_UNSUPPORTED_ENCRYPTION = "Encryption not supported";
	const ERR_UNSUPPORTED_COMPRESSION = "Compression method not supported";
	const EXTENDED_US_ASCII = ["\u00C7", "\u00FC", "\u00E9", "\u00E2", "\u00E4", "\u00E0", "\u00E5", "\u00E7", "\u00EA", "\u00EB",
		"\u00E8", "\u00EF", "\u00EE", "\u00EC", "\u00C4", "\u00C5", "\u00C9", "\u00E6", "\u00C6", "\u00F4", "\u00F6", "\u00F2", "\u00FB", "\u00F9",
		"\u00FF", "\u00D6", "\u00DC", "\u00F8", "\u00A3", "\u00D8", "\u00D7", "\u0192", "\u00E1", "\u00ED", "\u00F3", "\u00FA", "\u00F1", "\u00D1",
		"\u00AA", "\u00BA", "\u00BF", "\u00AE", "\u00AC", "\u00BD", "\u00BC", "\u00A1", "\u00AB", "\u00BB", "_", "_", "_", "\u00A6", "\u00A6",
		"\u00C1", "\u00C2", "\u00C0", "\u00A9", "\u00A6", "\u00A6", "+", "+", "\u00A2", "\u00A5", "+", "+", "-", "-", "+", "-", "+", "\u00E3",
		"\u00C3", "+", "+", "-", "-", "\u00A6", "-", "+", "\u00A4", "\u00F0", "\u00D0", "\u00CA", "\u00CB", "\u00C8", "i", "\u00CD", "\u00CE",
		"\u00CF", "+", "+", "_", "_", "\u00A6", "\u00CC", "_", "\u00D3", "\u00DF", "\u00D4", "\u00D2", "\u00F5", "\u00D5", "\u00B5", "\u00FE",
		"\u00DE", "\u00DA", "\u00DB", "\u00D9", "\u00FD", "\u00DD", "\u00AF", "\u00B4", "\u00AD", "\u00B1", "_", "\u00BE", "\u00B6", "\u00A7",
		"\u00F7", "\u00B8", "\u00B0", "\u00A8", "\u00B7", "\u00B9", "\u00B3", "\u00B2", "_", " "];
	const MAX_ZIP_COMMENT_SIZE = 65536;

	class ZipReader {

		constructor(reader, options = {}, config = {}) {
			this.reader = reader;
			this.options = options;
			this.config = config;
		}

		async getEntries() {
			const reader = this.reader;
			if (!reader.initialized) {
				await reader.init();
			}
			const directoryInfo = await seekSignature(reader, [0x50, 0x4b, 0x05, 0x06], 22, MAX_ZIP_COMMENT_SIZE);
			let zip64, directoryDataView = new DataView(directoryInfo.buffer);
			let dataLength = directoryDataView.getUint32(16, true);
			let filesLength = directoryDataView.getUint16(8, true);
			if (dataLength == 0xffffffff || filesLength == 0xffff) {
				zip64 = true;
				const directoryLocatorArray = await reader.readUint8Array(directoryInfo.offset - 20, 20);
				const directoryLocatorView = new DataView(directoryLocatorArray.buffer);
				if (Number(directoryLocatorView.getUint32(0, false)) != 0x504b0607) {
					throw new Error(ERR_EOCDR_ZIP64_NOT_FOUND);
				}
				dataLength = Number(directoryLocatorView.getBigUint64(8, true));
				const directoryDataArray = await reader.readUint8Array(dataLength, 56);
				const directoryDataView = new DataView(directoryDataArray.buffer);
				if (Number(directoryDataView.getUint32(0, false)) != 0x504b0606) {
					throw new Error(ERR_EOCDR_LOCATOR_ZIP64_NOT_FOUND);
				}
				filesLength = Number(directoryDataView.getBigUint64(24, true));
				dataLength -= Number(directoryDataView.getBigUint64(40, true));
			}
			if (dataLength < 0 || (!zip64 && (dataLength >= reader.size || filesLength >= 0xffff))) {
				throw new Error(ERR_BAD_FORMAT);
			}
			const dataArray = await reader.readUint8Array(dataLength, reader.size - dataLength);
			directoryDataView = new DataView(dataArray.buffer);
			const entries = [];
			let offset = 0;
			for (let indexFile = 0; indexFile < filesLength; indexFile++) {
				const entry = new Entry(this);
				if (directoryDataView.getUint32(offset, false) != 0x504b0102) {
					throw new Error(ERR_CENTRAL_DIRECTORY_NOT_FOUND);
				}
				entry.compressedSize = 0;
				entry.uncompressedSize = 0;
				readCommonHeader(entry, directoryDataView, offset + 6);
				entry.commentLength = directoryDataView.getUint16(offset + 32, true);
				entry.directory = ((directoryDataView.getUint8(offset + 38) & 0x10) == 0x10);
				entry.offset = directoryDataView.getUint32(offset + 42, true);
				entry.rawFilename = dataArray.subarray(offset + 46, offset + 46 + entry.filenameLength);
				const filename = getString(entry.rawFilename);
				entry.filename = entry.bitFlag.languageEncodingFlag ? decodeUTF8(filename) : decodeASCII(filename);
				if (!entry.directory && entry.filename.charAt(entry.filename.length - 1) == "/") {
					entry.directory = true;
				}
				entry.rawExtraField = dataArray.subarray(offset + 46 + entry.filenameLength, offset + 46 + entry.filenameLength + entry.extraFieldLength);
				readExtraField(entry, directoryDataView, offset + 6, true);
				entry.rawComment = dataArray.subarray(offset + 46 + entry.filenameLength + entry.extraFieldLength, offset + 46
					+ entry.filenameLength + entry.extraFieldLength + entry.commentLength);
				const comment = getString(entry.rawComment);
				entry.comment = entry.bitFlag.languageEncodingFlag ? decodeUTF8(comment) : decodeASCII(comment);
				entries.push(entry);
				offset += 46 + entry.filenameLength + entry.extraFieldLength + entry.commentLength;
			}
			return entries;
		}

		async close() {
		}
	}

	class Entry {

		constructor(zipReader) {
			this.reader = zipReader.reader;
			this.config = zipReader.config;
		}

		async getData(writer, options = {}) {
			const reader = this.reader;
			if (!reader.initialized) {
				await reader.init();
			}
			const dataArray = await reader.readUint8Array(this.offset, 30);
			const dataView = new DataView(dataArray.buffer);
			let inputPassword = options.password && options.password.length && options.password;
			if (dataView.getUint32(0, false) != 0x504b0304) {
				throw ERR_LOCAL_FILE_HEADER_NOT_FOUND;
			}
			readCommonHeader(this, dataView, 4);
			readExtraField(this, dataView, 4);
			let dataOffset = this.offset + 30 + this.filenameLength + this.extraFieldLength;
			if (!writer.initialized) {
				await writer.init();
			}
			if (this.passwordProtected && !inputPassword) {
				throw new Error(ERR_ENCRYPTED);
			}
			const codec = await createCodec(this.config, {
				codecType: CODEC_INFLATE,
				inputPassword,
				inputSigned: options.checkSignature,
				inputSignature: this.signature,
				inputCompressed: this.compressionMethod != 0,
				inputEncrypted: this.passwordProtected
			});
			await processData(codec, reader, writer, dataOffset, this.compressedSize, this.config, { onprogress: options.onprogress });
			return writer.getData();
		}
	}

	function readCommonHeader(entry, dataView, offset) {
		entry.version = dataView.getUint16(offset, true);
		const rawBitFlag = entry.rawBitFlag = dataView.getUint16(offset + 2, true);
		entry.bitFlag = {
			encrypted: (rawBitFlag & 0x01) == 0x01,
			level: (rawBitFlag & 0x06) >> 1,
			dataDescriptor: (rawBitFlag & 0x08) == 0x08,
			languageEncodingFlag: (rawBitFlag & 0x0800) == 0x0800
		};
		entry.rawLastModDate = dataView.getUint32(offset + 6, true);
		entry.lastModDate = getDate(entry.rawLastModDate);
		entry.filenameLength = dataView.getUint16(offset + 22, true);
		entry.extraFieldLength = dataView.getUint16(offset + 24, true);
	}

	function readExtraField(entry, dataView, offset, isCentralHeader) {
		let extraFieldZip64, extraFieldAES;
		const rawExtraField = entry.rawExtraField;
		if (rawExtraField) {
			const extraField = entry.extraField = new Map();
			const rawExtraFieldView = new DataView(new Uint8Array(rawExtraField).buffer);
			let offsetExtraField = 0;
			while (offsetExtraField < rawExtraField.length) {
				const type = rawExtraFieldView.getUint16(offsetExtraField, true);
				const size = rawExtraFieldView.getUint16(offsetExtraField + 2, true);
				extraField.set(type, {
					type,
					data: rawExtraField.slice(offsetExtraField + 4, offsetExtraField + 4 + size)
				});
				offsetExtraField += 4 + size;
			}
			extraFieldZip64 = entry.extraFieldZip64 = extraField.get(0x01);
			extraFieldAES = entry.extraFieldAES = extraField.get(0x9901);
			if (extraFieldZip64) {
				entry.zip64 = true;
				const extraFieldView = new DataView(extraFieldZip64.data.buffer);
				extraFieldZip64.values = [];
				for (let indexValue = 0; indexValue < Math.floor(extraFieldZip64.data.length / 8); indexValue++) {
					extraFieldZip64.values.push(Number(extraFieldView.getBigUint64(0 + indexValue * 8, true)));
				}
			}
			if (extraFieldAES && entry.bitFlag.encrypted) {
				entry.passwordProtected = true;
				const compressionMethod = dataView.getUint16(offset + 4, true);
				if (compressionMethod != 0x63) {
					throw new Error(ERR_UNSUPPORTED_COMPRESSION);
				}
				const extraFieldView = new DataView(extraFieldAES.data.buffer);
				extraFieldAES.vendorVersion = extraFieldView.getUint8(0);
				extraFieldAES.vendorId = extraFieldView.getUint8(2);
				const strength = extraFieldView.getUint8(4);
				extraFieldAES.compressionMethod = extraFieldView.getUint16(5, true);
				if (strength != 3) {
					throw new Error(ERR_UNSUPPORTED_ENCRYPTION);
				}
			}
		}
		if (extraFieldAES && extraFieldAES.compressionMethod !== undefined) {
			entry.compressionMethod = extraFieldAES.compressionMethod;
		} else {
			entry.compressionMethod = dataView.getUint16(offset + 4, true);
		}
		if (entry.compressionMethod != 0x0 && entry.compressionMethod != 0x08) {
			throw new Error(ERR_UNSUPPORTED_COMPRESSION);
		}
		if (entry.compressionMethod == 0x08) {
			entry.bitFlag.enhancedDeflating = (entry.rawBitFlag & 0x10) != 0x10;
		}
		if (isCentralHeader || !entry.bitFlag.dataDescriptor) {
			entry.signature = dataView.getUint32(offset + 10, true);
			entry.uncompressedSize = dataView.getUint32(offset + 18, true);
			entry.compressedSize = dataView.getUint32(offset + 14, true);
			const properties = ["uncompressedSize", "compressedSize", "offset"];
			const missingProperties = properties.filter(propertyName => entry[propertyName] == 0xffffffff);
			for (let indexMissingProperty = 0; indexMissingProperty < missingProperties.length; indexMissingProperty++) {
				extraFieldZip64[missingProperties[indexMissingProperty]] = extraFieldZip64.values[indexMissingProperty];
			}
			properties.forEach(propertyName => {
				if (entry[propertyName] == 0xffffffff) {
					if (extraFieldZip64 && extraFieldZip64[propertyName] !== undefined) {
						entry[propertyName] = extraFieldZip64 && extraFieldZip64[propertyName];
					} else {
						throw new Error(ERR_EXTRA_FIELD_ZIP64_NOT_FOUND);
					}
				}
			});
		}
	}

	async function seekSignature(reader, signature, minimumBytes, maximumLength) {
		if (reader.size < minimumBytes) {
			throw new Error(ERR_BAD_FORMAT);
		}
		const maximumBytes = minimumBytes + maximumLength;
		let offset = minimumBytes;
		let directoryInfo = await seek(offset);
		if (!directoryInfo) {
			directoryInfo = await seek(Math.min(maximumBytes, reader.size));
		}
		if (!directoryInfo) {
			throw new Error(ERR_EOCDR_NOT_FOUND);
		}
		return directoryInfo;

		async function seek(length) {
			const offset = reader.size - length;
			const bytes = await reader.readUint8Array(offset, length);
			for (let indexByte = bytes.length - minimumBytes; indexByte >= 0; indexByte--) {
				if (bytes[indexByte] == signature[0] && bytes[indexByte + 1] == signature[1] && bytes[indexByte + 2] == signature[2] && bytes[indexByte + 3] == signature[3]) {
					return {
						offset,
						buffer: bytes.slice(indexByte, indexByte + minimumBytes).buffer
					};
				}
			}
		}
	}

	function decodeASCII(str) {
		let result = "";
		for (let indexTable = 0; indexTable < str.length; indexTable++) {
			const charCode = str.charCodeAt(indexTable) & 0xFF;
			if (charCode > 127) {
				result += EXTENDED_US_ASCII[charCode - 128];
			} else {
				result += String.fromCharCode(charCode);
			}
		}
		return result;
	}

	function decodeUTF8(string) {
		return decodeURIComponent(escape(string));
	}

	function getString(bytes) {
		let result = "";
		for (let indexByte = 0; indexByte < bytes.length; indexByte++) {
			result += String.fromCharCode(bytes[indexByte]);
		}
		return result;
	}

	function getDate(timeRaw) {
		const date = (timeRaw & 0xffff0000) >> 16, time = timeRaw & 0x0000ffff;
		try {
			return new Date(1980 + ((date & 0xFE00) >> 9), ((date & 0x01E0) >> 5) - 1, date & 0x001F, (time & 0xF800) >> 11, (time & 0x07E0) >> 5, (time & 0x001F) * 2, 0);
		} catch (error) {
			// ignored
		}
	}

	/*
	 Copyright (c) 2021 Gildas Lormeau. All rights reserved.

	 Redistribution and use in source and binary forms, with or without
	 modification, are permitted provided that the following conditions are met:

	 1. Redistributions of source code must retain the above copyright notice,
	 this list of conditions and the following disclaimer.

	 2. Redistributions in binary form must reproduce the above copyright 
	 notice, this list of conditions and the following disclaimer in 
	 the documentation and/or other materials provided with the distribution.

	 3. The names of the authors may not be used to endorse or promote products
	 derived from this software without specific prior written permission.

	 THIS SOFTWARE IS PROVIDED ``AS IS'' AND ANY EXPRESSED OR IMPLIED WARRANTIES,
	 INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
	 FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL JCRAFT,
	 INC. OR ANY CONTRIBUTORS TO THIS SOFTWARE BE LIABLE FOR ANY DIRECT, INDIRECT,
	 INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
	 LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA,
	 OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
	 LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
	 NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
	 EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
	 */

	const MAX_COMMENT_LENGTH = 65536;
	const ERR_DUPLICATED_NAME = "File already exists";
	const ERR_ZIP_FILE_COMMENT = "Zip file comment exceeds 64KB";
	const ERR_FILE_ENTRY_COMMENT = "File entry comment exceeds 64KB";

	class ZipWriter {

		constructor(writer, options = {}, config = {}) {
			this.writer = writer;
			this.options = options;
			this.config = config;
			this.files = new Map();
			this.offset = writer.size;
			this.zip64 = options.zip64;
		}

		async add(name, reader, options = {}) {
			name = name.trim();
			if (options.directory && name.charAt(name.length - 1) != "/") {
				name += "/";
			}
			if (this.files.has(name)) {
				throw new Error(ERR_DUPLICATED_NAME);
			}
			options.comment = getBytes(encodeUTF8(options.comment || ""));
			if (options.comment > MAX_COMMENT_LENGTH) {
				throw new Error(ERR_FILE_ENTRY_COMMENT);
			}
			options.zip64 = options.zip64 || this.zip64;
			await addFile(this, name, reader, options);
		}

		async close(comment) {
			const writer = this.writer;
			const files = this.files;
			let offset = 0, directoryDataLength = 0, directoryOffset = this.offset, filesLength = files.size;
			for (const [, fileEntry] of files) {
				directoryDataLength += 46 + fileEntry.filename.length + fileEntry.comment.length + fileEntry.extraFieldZip64.length + fileEntry.extraFieldAES.length + fileEntry.rawExtraField.length;
			}
			if (this.zip64 || directoryOffset + directoryDataLength >= 0xffffffff || filesLength >= 0xffff) {
				this.zip64 = true;
			}
			const directoryDataArray = new Uint8Array(directoryDataLength + (this.zip64 ? 98 : 22));
			const directoryDataView = new DataView(directoryDataArray.buffer);
			for (const [, fileEntry] of files) {
				const filename = fileEntry.filename;
				const extraFieldZip64 = fileEntry.extraFieldZip64;
				const extraFieldAES = fileEntry.extraFieldAES;
				const extraFieldLength = extraFieldZip64.length + extraFieldAES.length + fileEntry.rawExtraField.length;
				directoryDataView.setUint32(offset, 0x504b0102);
				if (fileEntry.zip64) {
					directoryDataView.setUint16(offset + 4, 0x2d00);
				} else {
					directoryDataView.setUint16(offset + 4, 0x1400);
				}
				directoryDataArray.set(fileEntry.headerArray, offset + 6);
				directoryDataView.setUint16(offset + 30, extraFieldLength, true);
				directoryDataView.setUint16(offset + 32, fileEntry.comment.length, true);
				if (fileEntry.directory) {
					directoryDataView.setUint8(offset + 38, 0x10);
				}
				if (fileEntry.zip64) {
					directoryDataView.setUint32(offset + 42, 0xffffffff, true);
				} else {
					directoryDataView.setUint32(offset + 42, fileEntry.offset, true);
				}
				directoryDataArray.set(filename, offset + 46);
				directoryDataArray.set(extraFieldZip64, offset + 46 + filename.length);
				directoryDataArray.set(extraFieldAES, offset + 46 + filename.length + extraFieldZip64.length);
				directoryDataArray.set(fileEntry.rawExtraField, 46 + filename.length + extraFieldZip64.length + extraFieldAES.length);
				directoryDataArray.set(fileEntry.comment, offset + 46 + filename.length + extraFieldLength);
				offset += 46 + filename.length + extraFieldLength + fileEntry.comment.length;
			}
			if (this.zip64) {
				directoryDataView.setUint32(offset, 0x504b0606);
				directoryDataView.setBigUint64(offset + 4, BigInt(44), true);
				directoryDataView.setUint16(offset + 12, 45, true);
				directoryDataView.setUint16(offset + 14, 45, true);
				directoryDataView.setBigUint64(offset + 24, BigInt(filesLength), true);
				directoryDataView.setBigUint64(offset + 32, BigInt(filesLength), true);
				directoryDataView.setBigUint64(offset + 40, BigInt(directoryDataLength), true);
				directoryDataView.setBigUint64(offset + 48, BigInt(directoryOffset), true);
				directoryDataView.setUint32(offset + 56, 0x504b0607);
				directoryDataView.setBigUint64(offset + 64, BigInt(directoryOffset + directoryDataLength), true);
				directoryDataView.setUint32(offset + 72, 1, true);
				filesLength = 0xffff;
				directoryOffset = 0xffffffff;
				offset += 76;
			}
			directoryDataView.setUint32(offset, 0x504b0506);
			directoryDataView.setUint16(offset + 8, filesLength, true);
			directoryDataView.setUint16(offset + 10, filesLength, true);
			directoryDataView.setUint32(offset + 12, directoryDataLength, true);
			directoryDataView.setUint32(offset + 16, directoryOffset, true);
			if (comment && comment.length) {
				if (comment.length <= MAX_COMMENT_LENGTH) {
					directoryDataView.setUint16(offset + 20, comment.length, true);
				} else {
					throw new Error(ERR_ZIP_FILE_COMMENT);
				}
			}
			await writer.writeUint8Array(directoryDataArray);
			if (comment && comment.length) {
				await writer.writeUint8Array(comment);
			}
			return writer.getData();
		}
	}

	async function addFile(zipWriter, name, reader, options) {
		const files = zipWriter.files, writer = zipWriter.writer;
		files.set(name, null);
		let resolveLockWrite;
		try {
			let fileWriter, fileEntry;
			try {
				if (options.bufferedWrite || zipWriter.lockWrite) {
					fileWriter = new Uint8ArrayWriter();
					fileWriter.init();
				} else {
					zipWriter.lockWrite = new Promise(resolve => resolveLockWrite = resolve);
					if (!writer.initialized) {
						await writer.init();
					}
					fileWriter = writer;
				}
				if (zipWriter.offset >= 0xffffffff || (reader && (reader.size >= 0xffffffff || zipWriter.offset + reader.size >= 0xffffffff))) {
					options.zip64 = true;
				}
				fileEntry = await createFileEntry(name, reader, fileWriter, zipWriter.config, options);
			} catch (error) {
				files.delete(name);
				throw error;
			}
			files.set(name, fileEntry);
			if (fileWriter != writer) {
				if (zipWriter.lockWrite) {
					await zipWriter.lockWrite;
				}
				await writer.writeUint8Array(fileWriter.getData());
			}
			fileEntry.offset = zipWriter.offset;
			if (fileEntry.zip64) {
				const extraFieldZip64View = new DataView(fileEntry.extraFieldZip64.buffer);
				extraFieldZip64View.setBigUint64(20, BigInt(fileEntry.offset), true);
			}
			zipWriter.offset += fileEntry.length;
		} finally {
			if (resolveLockWrite) {
				zipWriter.lockWrite = null;
				resolveLockWrite();
			}
		}
	}

	async function createFileEntry(name, reader, writer, config, options) {
		const filename = getBytes(encodeUTF8(name));
		const date = options.lastModDate || new Date();
		const headerArray = new Uint8Array(26);
		const headerView = new DataView(headerArray.buffer);
		const outputPassword = options.password && options.password.length && options.password;
		const compressed = options.level !== 0 && !options.directory;
		const outputSigned = options.password === undefined || !options.password.length;
		const zip64 = options.zip64;
		const fileEntry = {
			zip64,
			headerArray: headerArray,
			directory: options.directory,
			filename: filename,
			comment: options.comment,
			extraFieldZip64: zip64 ? new Uint8Array(28) : new Uint8Array(0),
			extraFieldAES: outputPassword ? new Uint8Array([0x01, 0x99, 0x07, 0x00, 0x02, 0x00, 0x41, 0x45, 0x03, 0x00, 0x00]) : new Uint8Array(0),
			rawExtraField: new Uint8Array(0)
		};
		const extraField = options.extraField;
		if (extraField) {
			let extraFieldSize = 4, offset = 0;
			extraField.forEach(data => extraFieldSize += data.length);
			const rawExtraField = fileEntry.rawExtraField = new Uint8Array(extraFieldSize);
			extraField.forEach((data, type) => {
				rawExtraField.set(new Uint16Array([type]), offset);
				rawExtraField.set(new Uint16Array([data.length]), offset + 2);
				rawExtraField.set(data, offset + 4);
				offset += 4 + data.length;
			});
		}
		options.bitFlag = 0x08;
		options.version = options.version || 0x14;
		options.compressionMethod = 0;
		if (compressed) {
			options.compressionMethod = 0x08;
		}
		if (zip64) {
			options.version = options.version > 0x2D ? options.version : 0x2D;
		}
		if (outputPassword) {
			options.version = options.version > 0x33 ? options.version : 0x33;
			options.bitFlag = 0x09;
			options.compressionMethod = 0x63;
			if (compressed) {
				fileEntry.extraFieldAES[9] = 0x08;
			}
		}
		headerView.setUint16(0, options.version, true);
		headerView.setUint16(2, options.bitFlag, true);
		headerView.setUint16(4, options.compressionMethod, true);
		headerView.setUint16(6, (((date.getHours() << 6) | date.getMinutes()) << 5) | date.getSeconds() / 2, true);
		headerView.setUint16(8, ((((date.getFullYear() - 1980) << 4) | (date.getMonth() + 1)) << 5) | date.getDate(), true);
		headerView.setUint16(22, filename.length, true);
		headerView.setUint16(24, 0, true);
		const fileDataArray = new Uint8Array(30 + filename.length);
		const fileDataView = new DataView(fileDataArray.buffer);
		fileDataView.setUint32(0, 0x504b0304);
		fileDataArray.set(headerArray, 4);
		fileDataArray.set(filename, 30);
		let result;
		if (reader) {
			if (!reader.initialized) {
				await reader.init();
			}
			const codec = await createCodec(config, {
				codecType: CODEC_DEFLATE,
				level: options.level,
				outputPassword: options.password,
				outputSigned,
				outputCompressed: compressed,
				outputEncrypted: Boolean(options.password)
			});
			await writer.writeUint8Array(fileDataArray);
			result = await processData(codec, reader, writer, 0, reader.size, config, { onprogress: options.onprogress });
			fileEntry.compressedSize = result.length;
		} else {
			await writer.writeUint8Array(fileDataArray);
		}
		const footerArray = new Uint8Array(zip64 ? 24 : 16);
		const footerView = new DataView(footerArray.buffer);
		footerView.setUint32(0, 0x504b0708);
		if (reader) {
			if (!outputPassword && result.signature !== undefined) {
				headerView.setUint32(10, result.signature, true);
				footerView.setUint32(4, result.signature, true);
			}
			if (zip64) {
				headerView.setUint32(14, 0xffffffff, true);
				footerView.setBigUint64(8, BigInt(fileEntry.compressedSize), true);
				headerView.setUint32(18, 0xffffffff, true);
				footerView.setBigUint64(16, BigInt(reader.size), true);
				const extraFieldZip64View = new DataView(fileEntry.extraFieldZip64.buffer);
				extraFieldZip64View.setUint16(0, 0x01, true);
				extraFieldZip64View.setUint16(2, 24, true);
				extraFieldZip64View.setBigUint64(4, BigInt(reader.size), true);
				extraFieldZip64View.setBigUint64(12, BigInt(fileEntry.compressedSize), true);
			} else {
				headerView.setUint32(14, fileEntry.compressedSize, true);
				footerView.setUint32(8, fileEntry.compressedSize, true);
				headerView.setUint32(18, reader.size, true);
				footerView.setUint32(12, reader.size, true);
			}
		}
		await writer.writeUint8Array(footerArray);
		fileEntry.length = fileDataArray.length + (result ? result.length : 0) + footerArray.length;
		return fileEntry;
	}

	function encodeUTF8(string) {
		return unescape(encodeURIComponent(string));
	}

	function getBytes(string) {
		const bytes = [];
		for (let indexString = 0; indexString < string.length; indexString++) {
			bytes.push(string.charCodeAt(indexString));
		}
		return bytes;
	}

	const FUNCTION_TYPE = "function";

	var streamCodecShim = (library, options = {}) => {
		return {
			ZipDeflate: createCodecClass(library.Deflate, options.deflate),
			ZipInflate: createCodecClass(library.Inflate, options.inflate)
		};
	};

	function createCodecClass(constructor, constructorOptions) {
		return class {
			constructor(options) {
				const onData = data => {
					if (this.pendingData) {
						const pendingData = this.pendingData;
						this.pendingData = new Uint8Array(pendingData.length + data.length);
						this.pendingData.set(pendingData, 0);
						this.pendingData.set(data, pendingData.length);
					} else {
						this.pendingData = new Uint8Array(data);
					}
				};
				this.codec = new constructor(Object.assign({}, constructorOptions, options));
				if (typeof this.codec.onData == FUNCTION_TYPE) {
					this.codec.onData = onData;
				} else if (typeof this.codec.on == FUNCTION_TYPE) {
					this.codec.on("data", onData);
				} else {
					throw new Error("Cannot register the callback function");
				}
			}
			async append(data) {
				this.codec.push(data);
				return getResponse(this);
			}
			async flush() {
				this.codec.push(new Uint8Array(0), true);
				return getResponse(this);
			}
		};

		function getResponse(codec) {
			if (codec.pendingData) {
				const output = codec.pendingData;
				codec.pendingData = null;
				return output;
			} else {
				return new Uint8Array(0);
			}
		}
	}

	/*
	 Copyright (c) 2021 Gildas Lormeau. All rights reserved.

	 Redistribution and use in source and binary forms, with or without
	 modification, are permitted provided that the following conditions are met:

	 1. Redistributions of source code must retain the above copyright notice,
	 this list of conditions and the following disclaimer.

	 2. Redistributions in binary form must reproduce the above copyright 
	 notice, this list of conditions and the following disclaimer in 
	 the documentation and/or other materials provided with the distribution.

	 3. The names of the authors may not be used to endorse or promote products
	 derived from this software without specific prior written permission.

	 THIS SOFTWARE IS PROVIDED ``AS IS'' AND ANY EXPRESSED OR IMPLIED WARRANTIES,
	 INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
	 FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL JCRAFT,
	 INC. OR ANY CONTRIBUTORS TO THIS SOFTWARE BE LIABLE FOR ANY DIRECT, INDIRECT,
	 INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
	 LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA,
	 OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
	 LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
	 NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
	 EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
	 */

	const DEFAULT_CONFIGURATION = {
		chunkSize: 512 * 1024,
		maxWorkers: (typeof navigator != "undefined" && navigator.hardwareConcurrency) || 2,
		workerScriptsPath: undefined,
		useWebWorkers: true
	};

	let config = Object.assign({}, DEFAULT_CONFIGURATION);

	class ZipReader$1 extends ZipReader {

		constructor(reader, options) {
			super(reader, options, config);
		}
	}

	class ZipWriter$1 extends ZipWriter {

		constructor(writer, options) {
			super(writer, options, config);
		}
	}

	function configure(configuration) {
		config = Object.assign({}, config, configuration);
	}

	function getMimeType() {
		return "application/octet-stream";
	}

	exports.BlobReader = BlobReader;
	exports.BlobWriter = BlobWriter;
	exports.Data64URIReader = Data64URIReader;
	exports.Data64URIWriter = Data64URIWriter;
	exports.HttpRangeReader = HttpRangeReader;
	exports.HttpReader = HttpReader;
	exports.Reader = Reader;
	exports.TextReader = TextReader;
	exports.TextWriter = TextWriter;
	exports.Uint8ArrayReader = Uint8ArrayReader;
	exports.Uint8ArrayWriter = Uint8ArrayWriter;
	exports.Writer = Writer;
	exports.ZipReader = ZipReader$1;
	exports.ZipWriter = ZipWriter$1;
	exports.configure = configure;
	exports.getMimeType = getMimeType;
	exports.initShimAsyncCodec = streamCodecShim;

	Object.defineProperty(exports, '__esModule', { value: true });

})));
