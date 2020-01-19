const MAXLEN = 6 // 最大切片的个数

const loop = function () {}

let chunks = []

// 切片的xhr
let requestList = []

/*
 	把文件进行切片, 返回切片组成的数组
	@params file 文件对象
	@return Array[{file: fileChunk}]
*/
async function sliceFile (file, length=MAXLEN) {
	if (!file) {
		return []
	}
	// 切片的个数有可能比length少一个
	const chunkSize = Math.ceil(file.size / length)
	chunks = []
	let cur = 0
	let index = 0
	while (cur < file.size) {
		// slice的最后一个参数大于数组长度时，自动截取到数组长度
		chunks.push({
			"file": file.slice(cur, cur + chunkSize),
			"filename": file.name,
			"index": index,
			"percentage": 0
		})
		cur += chunkSize
		index += 1
	}
	let hash = await caclFileHash(onHashProgress)
	
	const loadedChunks = await getLoadedChunk(hash, file.name)
	console.log(loadedChunks, 1111111, typeof loadedChunks)
	if (loadedChunks.data.length === chunks.length) {
		console.log(22222222)
		progressBar.value = 100
	} else {
		const chunkList = []
		for (let i = 0; i < chunks.length; i++) {
			let chunk = chunks[i]
			chunk.hash = hash
			if (!loadedChunks.data.includes(''+i)) {
				chunkList.push(chunk)
			}
		}
		uploadChunks(chunkList)
	}
	return chunks
}

// 计算文件的hash
function caclFileHash (cb) {
	// 利用web-worker线程进行计算文件的hash
	return new Promise(function(resolve, reject) {
		const worker = new Worker('./hash.js')
		worker.postMessage(chunks)
		worker.onmessage = function (ev) {
			const { percentage , hash } = ev.data
			// 计算的进度
			cb(percentage)
			// 如果全部计算完成
			if (hash) {
				resolve(hash)
			}
		}
	})
}

const hashProgress = document.getElementById('hashProgress')
// 监听文件计算hash的进度
function onHashProgress (percentage) {
	hashProgress.value = percentage
}

/* 
	获取文件是否已经上传的chunk
	@params hash 文件的hash
	@return Array 已经上传的chunk的index
*/
function getLoadedChunk (hash, filename) {
	return ajax({
		url: `http://localhost:3000/getChunk?hash=${hash}&filename=${filename}`,
		method: 'GET',
		headers: {
			'content-type': 'application/json'
		}
	})
}

/*
 通过XMLHttpRequest上传切片到服务器
 @parmas chunks Array[{file: fileChunk}]
 */
async function uploadChunks (chunks) {
	if (chunks.length === 0) {
		return
	}

	const requests = chunks.map((chunk, index) => {
		let formData = new FormData()
		formData.append('chunk', chunk.file)
		formData.append('hash', chunk.hash)
		formData.append('filename', chunk.filename)
		formData.append('index', chunk.index)
		return {formData, chunk}
	}).map(({formData, chunk}) => {
		return ajax({
			url: 'http://localhost:3000/upload',
			method: 'POST',
			data: formData,
			requestList: requestList,
			onprogress: uploadProgress(chunk)
		})
	})
	// 并发切片请求
	await Promise.all(requests)
	console.log(requestList, '----------')
	// 发送合并请求
	// ajax({
	// 	url: `http://localhost:3000/mergeChunk?hash=${chunks[0].hash}&filename=${chunks[0].filename}`,
	// 	method: 'GET',
	// })
}

/*
	文件上传成功的回调
	@params res 某个块上传成功的response
	@params chunks 文件切片后的所有块
 */

function uploadSuccess (res) {

}

/*
	文件上传失败的回调
 */

function uploadFail (err) {

}

// 取消请求
function abortRequest () {
	for(let xhr of requestList) {
		if (xhr.status !== 200) {
			xhr.abort()
		}
	}
}

/*
	文件上传过程的回调
	@params ev 某个块上传过程的ev事件参数
	@params chunks 文件切片后的所有块
 */
function uploadProgress (chunk) {
	return function (ev) {
		chunk.percentage = (ev.loaded / ev.total)
		calcTotalPercentage()
	}
}

var progressBar = document.getElementById('progress')

function calcTotalPercentage () {
	let total = 0
	let loadedSize = 0
	let totalSize = 0
	for (let chunk of chunks) {
		loadedSize += chunk.file.size * chunk.percentage
		totalSize += chunk.file.size
	}
	total = ((loadedSize / totalSize) * 100).toFixed(2)
	progressBar.value = total
	console.log(total, 'progress')
	return total
}

/*
	为每个切片创建一个XMLHttpRequest请求
	@return promise
 */
function ajax ({
	url,
	method = 'GET',
	data,
	requestList, // 一个文件的所有切片请求的xhr
	headers={},
	onerror=loop,
	onprogress=loop,
	onload=loop,
	ontimeout=loop
}) {
	return new Promise(function (resolve, reject) {
		const xhr = new XMLHttpRequest()
		xhr.open(method, url, true)
		Object.keys(headers).forEach(function (key) {
			xhr.setRequestHeader(key, headers[key])
		})
		xhr.onload = function (ev) {
			let data
			console.log(xhr.getResponseHeader('content-type'), '76654')
			if (xhr.getResponseHeader('content-type') ==='application/json; charset=utf-8') {
				data = JSON.parse(xhr.responseText)
			} else {
				data = xhr.responseText
			}
			onload(data, requestList)
			resolve(data)
		}
		xhr.onerror = function (ev) {
			onerror(ev)
			reject(ev)
		}
		xhr.upload.onprogress = function (ev) {
			onprogress(ev, requestList)
		}
		xhr.ontimeout = function (ev) {
			ontimeout(ev)
			reject(ev)
		}
		// 用于取消请求
		requestList && requestList.push(xhr)
		xhr.send(data)
	})
}



