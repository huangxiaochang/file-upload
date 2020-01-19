// 脚本执行的node_module会逐级向上查找
const path = require('path')
const fse = require('fs-extra')
const multiparty = require('multiparty')
const ejs = require('ejs')
const express = require('express')
const app = express()

// 静态文件的目录
const STATICPATH = path.resolve(__dirname, '../client')

// 文件上传的目录
const UPLOADDIR = path.resolve(__dirname, './static')

app.use(express.static(STATICPATH))

app.engine('html', ejs.__express)
app.set('view engine', 'html')
app.set('views', STATICPATH)

app.get('/index', function(req, res) {
  res.render('index')
});


app.post('/upload', function (req, res) {
	res.setHeader("Access-Control-Allow-Origin", "*")
	res.setHeader("Access-Control-Allow-Headers", "*")
	if (req.method === 'OPPTIONS') {
		res.status(200)
		res.send({success: 1})
		return
	}
	// 解析form数据
	const mp = new multiparty.Form()
	mp.parse(req, async function (err, filds, files) {
		if (err) {
			console.log(err)
			return
		}
		const [hash] = filds.hash
		const [index] = filds.index
		const [filename] = filds.filename
		const [chunk] = files.chunk
		// console.log(hash,chunk,filename)

		const chunkDir = `${UPLOADDIR}/${hash}`

		if (!fse.existsSync(chunkDir)) {
			await fse.mkdirs(chunkDir)
		}

		await fse.move(chunk.path, `${chunkDir}/${hash}-${index}`)

		res.status(200)
		res.send({success: 1})
	})
})

// 合并切片的请求
app.get('/mergeChunk', async function (req, res) {
	const params = req.query
	if (!params.filename ||!params.hash) {
		res.status(404)
		res.json({success: 0, msg: '参数不正确'})
	}
	console.log(params)
	const chunkDir = `${UPLOADDIR}/${params.hash}`
	if (!fse.existsSync(chunkDir)) {
		res.status(404)
		res.json({success: 0, msg: '文件不存在，请先上传!'})
	}
	// 合并切片
	const chunkPaths = await fse.readdir(chunkDir)
	const filepath = `${UPLOADDIR}/img/${params.filename}`
	// 先创建一个空的文件
	await fse.writeFile(filepath, "")
	// 把切片合并
	chunkPaths.forEach(function (chunkPath) {
		fse.appendFileSync(filepath, fse.readFileSync(`${chunkDir}/${chunkPath}`));
		fse.unlinkSync(`${chunkDir}/${chunkPath}`);
	})
	// 合并后删除保存切片的目录
	fse.rmdirSync(chunkDir)
	res.status(200)
	res.json({success: 1, msg: '上传成功'})
})

// 请求某个文件已经上传的chunk
app.get('/getChunk', async function (req, res) {
	const params = req.query
	if (!params.hash) {
		res.status(404)
		res.send({success: 0, msg: '参数不正确'})
	}
	const chunkDir = `${UPLOADDIR}/${params.hash}`
	if (!fse.existsSync(chunkDir)) {
		res.status(200)
		res.send({success: 1, data: []})
	}
	const chunkPaths = await fse.readdir(chunkDir)
	// const data = []
	// chunkPaths.forEach(function (chunk) {
	// 	console.log(chunk, '999999')
	// 	const path = chunk.split('-')
	// 	data.push(path[1])
	// })
	res.status(200)
	res.json({success: 1, data: chunkPaths})
})


app.listen(3000, function () {
	console.log('server runing at: http://localhost:3000')
})

