// 根据文件内容计算文件的hash的web-worker
// 这里使用到了spark-md5这个库来进行计算

// 引入spark-md5.web-worker线程中，提供了importScripts来导入外部脚本
self.importScripts("./spark-md5.min.js")

// 监听主线程发来的文件切片
self.onmessage = function (ev) {
	const chunks = ev.data
	const sparkMd5 = new self.SparkMD5.ArrayBuffer()
	let percentage = 0
	let count = 0

	function calcHash (index) {
		const reader = new FileReader()
		reader.readAsArrayBuffer(chunks[index].chunk)
		reader.onload = function (ev) {
			count++
			// 把文件切片添加到spark-md5中,进行计算hash
			sparkMd5.append(ev.target.result)
			if (count === chunks.length) {
				self.postMessage({
					percentage: 100,
					hash: sparkMd5.end()
				})
			} else {
				percentage += 100 / chunks.length
				self.postMessage({
					percentage: percentage,
					hash: null
				})
				calcHash(count)
			}
		}
	}

	calcHash(0)
}

