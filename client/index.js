(function (globalNS) {
	const loop = function () {}
	const assetType = function (val, type) {
		return Object.prototype.toString.call(val) === `[object ${type}]`
	}
	// 每个切片的大小
	const chunkSize = 1024 * 1024 * 10 // 10MB
	// 每次最大的请求个数
	const maxRequest = 6
	/* 封装xhr请求
		@return promise
	*/
	function ajax({
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
				const responseHeader = xhr.getResponseHeader('content-type')
				if (responseHeader.indexOf('application/json') !== -1) {
					data = JSON.parse(xhr.responseText)
				} else {
					data = xhr.responseText
				}
				onload(data)
				resolve(data)
			}
			xhr.onerror = function (ev) {
				onerror(ev)
				reject(ev)
			}
			xhr.upload.onprogress = function (ev) {
				onprogress(ev)
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

	/*
		@params url 文件上传的url
		@params options 其他配置
		@return undefined
	 */
	function FileUpload (url, options={}) {
		if (!(this instanceof FileUpload)) {
			throw new TypeError('FileUpload must be constructed via new')
		}
		if (typeof url !== 'string') {
			options = url || {}
			url = options.url
		}
		if (!assetType(options, 'Object')) {		
			options = {}
		}
		this._init(url, options)
	}

	FileUpload.prototype = {
		_init: function (url, options) {
			this._file = null
			this._chunks = [] // 用于存储文件的切片
			this._requests = [] // 用于存储切片的请求
			this._onHashChangeCbs = [] // 文件hash计算的回调
			this._onProgressCbs = [] // 上传过程的回调
			this._onSuccessCbs = [] // 文件上传成功的回调
			this._onErrorCbs = [] // 文件上传失败的回调
			this._onTimeoutCbs = [] // 文件上传超时的回调
			this._url = url
			this._options = options
			this._maxChunk = 0
			this._chunkSize = 0
			this._chunkNum = 0 // 实际的切片数量
			this._hash = null // 文件的内容hash
			this._loadedChunk = [] // 已经上传的chunk
			this._loadedPercentage = 0 // 已经上传的比例
			// 最大的chunk数量
			assetType(options.maxChunk, 'Number') && (this._maxChunk = options.maxChunk)
			// 每个chunk的大小
			assetType(options.chunkSize, 'Number') && (this._chunkSize = options.chunkSize)

			assetType(options.onHashChange, 'Function') && this._onHashChangeCbs.push(options.onHashChange)
			assetType(options.onProgress, 'Function') && this._onProgressCbs.push(options.onProgress)
			assetType(options.onSuccess, 'Function') && this._onSuccessCbs.push(options.onSuccess)
			assetType(options.onError, 'Function') && this._onErrorCbs.push(options.onError)
			assetType(options.onTimeout, 'Function') && this._onTimeoutCbs.push(options.onTimeout)
		},
		/*
			设置需要上传的文件
			@params file 文件对象或者null
			@return percentage 文件已经上传的进度
		 */
		setFile: async function (file) {
			if (!file) {
				this._file = file
			} else if (!(file instanceof File)) {
				throw new TypeError(`${file} is not a file object`)
			}
			this._file = file
			this._sliceFile(file)
			// 计算该文件已经上传的进度
			this._hash = await this._generateHash(this._chunks)
			// 获取之前已经上传的进度
			const loadedPercentage = (localStorage.getItem(this._hash) || 0) * 1

			this._loadedPercentage = loadedPercentage.toFixed(4) * 1
			return this._loadedPercentage
		},
		/* 开始上传
			@params file 文件对象
			@params url 上传的url
			@return promise
		*/ 
		upload: async function (file, url) {
			file = file || this._file
			if (!(file instanceof File)) {
				throw new TypeError(`${file} is not a file object`)
			}
			assetType(url, 'String') && (this._url = url)
			if (this._url === '') {
				return false
			}
			this._file = file
			if (this._chunks.length === 0) {
				this._sliceFile(file)
			}
			
			if (!this._hash) {
				this._hash = await this._generateHash(this._chunks)
			}
			// 获取之前已经上传的进度
			const loadedPercentage = localStorage.getItem(this._hash)
			this._loadedPercentage = loadedPercentage ? loadedPercentage * 1 : 0

			const loadedChunk = await this._getLoadedChunk(this._hash)
			this._loadedChunk = loadedChunk.data
		
			this._uploadChunk(this._chunks, this._loadedChunk)
		},
		/*
			进行文件切片
			@params file 文件对象
		 */
		_sliceFile (file) {
			if (!file) { return false }
			// 如果指定每个chunk的个数，则按照个数来切分文件,否则按照chunk的大小
			const chunkSize = this._maxChunk === 0
												? (this._chunkSize || chunkSize) // 默认为10MB
												: Math.ceil(file.size / length) // 切片的个数有可能比length少一个

			this._chunks = []
			let cur = 0
			let index = 0
			while (cur < file.size) {
				// slice的最后一个参数大于数组长度时，自动截取到数组长度
				this._chunks.push({
					"chunk": file.slice(cur, cur + chunkSize),
					"filename": file.name,
					"index": index,
					"percentage": 0 // chunk上传的比例
				})
				cur += chunkSize
				index += 1
			}
			this._chunkNum = index
		},
		/*
			生成文件内容的hash,使用spark-md5来计算hash,由于文件可能较大，所以使用web-worker进行计算
			@params chunks 文件的所有chunk
			@return hash 
		 */
		_generateHash (chunks) {
			let self = this
			return new Promise(function(resolve, reject) {
				const worker = new Worker('./hash.js')
				worker.postMessage(chunks)
				worker.onmessage = function (ev) {
					const { percentage, hash } = ev.data
					// 计算的进度
					self._invoteCbs('onHashChange', percentage)
					// 如果全部计算完成
					if (hash) {
						resolve(hash)
						worker.terminate()
					}
				}
				worker.onerror = function (ev) {
					reject(ev)
					// 关闭web-worker
					worker.terminate()
				}
			})
		},
		/*
			获取已经上传的chunk
			@params hash 文件内容的hash
		 */
		_getLoadedChunk (hash) {
			return ajax({
				url: `http://localhost:3000/getChunk?hash=${hash}`,
				method: 'GET',
				headers: {
					'content-type': 'application/json'
				}
			})
		},
		/*
			上传文件的chunk, 只上传还没上传的chunk
			@params chunks 文件总的chunk
			@params loadedChunks 已经上传的chunk
		 */
		_uploadChunk (chunks, loadedChunks) {
			const chunkRequestList = []

			// 一次最大只能发起maxRequest个请求，然后每完成一个，就接着发送
			let num = 6

			var runQueue = (function (index) {
				if (index >= this._chunks.length) {
					return 
				}
				chunk = this._chunks[index]
				chunk.hash = this._hash
				let key = `${this._hash}-${chunk.index}`

				if (!loadedChunks.includes(key)) {
					let formData = new FormData()
					formData.append('chunk', chunk.chunk)
					formData.append('hash', chunk.hash)
					formData.append('filename', chunk.filename)
					formData.append('index', chunk.index)

					chunkRequestList.push(ajax({
						url: this._url,
						method: 'POST',
						data: formData,
						requestList: this._requests,
						onload: nextUpload(),
						onprogress: this._uploadChunkProgress(chunk)
					}))
				} else {
					// 表示已经加载完成，用于计算中的进度, 如果已经全部上传，可以达到秒传的效果
					chunk.percentage = 1
					this._uploadProgress()
					runQueue(num++)
				}
			}).bind(this)

			function nextUpload () {
				return function (val) {
					runQueue(num++)
				}
			}

			for (let i = 0 ; i < maxRequest; i++) {
				runQueue(i)
			}
		},
		/*
			chunk上传的进度
			@params chunk 上传的chunk
		 */
		_uploadChunkProgress (chunk) {
			let self = this
			return function (ev) {
				chunk.percentage = (ev.loaded / ev.total)
				// 计算总的进度
				self._uploadProgress()
			}
		},
		/*
			计算总的上传进度
		 */
		_uploadProgress () {
			let total = 0
			let loadedSize = 0
			let totalSize = 0
			for (let chunk of this._chunks) {
				loadedSize += chunk.chunk.size * chunk.percentage
				totalSize += chunk.chunk.size
			}
			total = (loadedSize / totalSize) * 100
			if (total > this._loadedPercentage) {
				// 防止进度倒退
				this._loadedPercentage = total
			}
			this._invoteCbs('onProgress', this._loadedPercentage)
			if (total >= 100) {
				// 如果全部上传完成
				this._handleLoaded()
			}
			return total
		},
		/*
			全部上传完成之后，进行文件的chunk的合并
		 */ 
		_handleLoaded () {
			// 并且的地址可以是传递进来的，也可以是在服务器端接收到全部的chunk是，自动合并，但是需要每次
			// 上传chunk时，传进最大的chunk数量
			let self = this
			ajax({
				url: `http://localhost:3000/mergeChunk?hash=${this._hash}&filename=${this._file.name}`,
				method: 'GET',
			}).then(function (data) {
				self._invoteCbs('onSuccess', data)
			}).catch(function (err) {
				self._invoteCbs('onError', err)
			})
		},
		/*
			重新上传

		 */
		reUpload: async function () {
			if (!this._file) {
				console.warn('请先选择要上传的文件!')
				return
			}
			if (this._chunks.length === 0) {
				// 如果是关闭或者刷新之后的重新上传
				this.upload(this._file)
			} else {
				const loadedChunk = await this._getLoadedChunk(this._hash)
				this._loadedChunk = loadedChunk.data

				this._uploadChunk(this._chunks, this._loadedChunk)
			}
		},
		/*
			取消上传
		 */
		cancelUpload () {
			for(let req of this._requests) {
				if (req.percentage !== 0) {
					req.abort()
				}
			}
			localStorage.setItem(this._hash, this._loadedPercentage)
			this._requests = []
		},
		/*
			执行回调
			@params type 回调类型
			@parms data 回调的参数
		 */
		_invoteCbs (type, ...data) {
			const cbs = this[`_${type}Cbs`]
			for (let cb of cbs) {
				cb.apply(this, data)
			}
		},
		// 销毁实例
		destory: function () {
			this._chunks = null
			this._requests = null
			this._onHashCbs = null
			this._onProgressCbs = null
			this._onSuccessCbs = null
			this._onErrorCbs = null
			this._onTimeoutCbs = null
			this._url = null
			this._options = null
			this._maxChunk = null
			this._chunkSize = null
			this._loadedChunk = null
			this._file = null
		}
	}

	FileUpload.prototype.constructor = FileUpload

	globalNS && (globalNS.FileUpload = FileUpload);
	return FileUpload
})(window)