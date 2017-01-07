const fs = require('fs')
const path = require('path')
const express = require('express')
const favicon = require('serve-favicon')
const compression = require('compression')
const serialize = require('serialize-javascript')
const resolve = (file) => path.resolve(__dirname, file)

const isProd = process.env.NODE_ENV === 'production'
const serverInfo =
  `express/${require('express/package.json').version} ` +
  `vue-server-renderer/${require('vue-server-renderer/package.json').version}`

const app = express()

let indexHTML // generated by html-webpack-plugin
let renderer  // created from the webpack-generated server bundle
if (isProd) {
  // in production: create server renderer and index HTML from real fs
  renderer = createRenderer(fs.readFileSync(resolve('./dist/server.js'), 'utf-8'))
  indexHTML = parseIndex(fs.readFileSync(resolve('./dist/_index.html'), 'utf-8'))
} else {
  // in development: setup the dev server with watch and hot-reload,
  // and update renderer / index HTML on file change.
  require('./setup-dev-server')(app, {
    bundleUpdated: (bundle) => {
      renderer = createRenderer(bundle)
    },
    indexUpdated: (index) => {
      indexHTML = parseIndex(index)
    }
  })
}

function createRenderer (bundle) {
  return require('vue-server-renderer').createBundleRenderer(bundle, {
    cache: require('lru-cache')({
      max: 1000,
      maxAge: 1000 * 60 * 15
    })
  })
}

function parseIndex (template) {
  const i = template.indexOf('</body>')
  return {
    head: template.slice(0, i),
    tail: template.slice(i)
  }
}

const serve = (path, cache) => express.static(resolve(path), {
  maxAge: cache && isProd ? 1000 * 60 * 60 * 24 * 30 : 0
})

app.use(serve('./public', true))
app.use(compression({ threshold: 0 }))
app.use('/service-worker.js', serve('./dist/service-worker.js'))
app.use('/dist', serve('./dist'))

app.get('*', (req, res) => {
  if (!renderer) {
    return res.end('waiting for compilation... refresh in a moment.')
  }

  res.setHeader('Content-Type', 'text/html')
  res.setHeader('Server', serverInfo)

  var s = Date.now()
  const context = { url: req.url }
  const renderStream = renderer.renderToStream(context)

  renderStream.once('data', () => {
    const {
      title, htmlAttrs, bodyAttrs, link, style, script, noscript, meta
    } = context.meta.inject()

    res.write(`
      <!DOCTYPE html>
      <html data-vue-meta-server-rendered ${htmlAttrs.text()}>
        <head>
          ${meta.text()}
          ${title.text()}
          ${link.text()}
          ${style.text()}
          ${script.text()}
          ${noscript.text()}
          <title>Portfolio</title>
        </head>
        <body ${bodyAttrs.text()}>
    `)
  })

  renderStream.on('data', (chunk) => {
    res.write(chunk)
  })

  renderStream.on('end', () => {
    // embed initial store state
    if (context.initialState) {
      res.write(
        `<script>window.__INITIAL_STATE__=${
          serialize(context.initialState, { isJSON: true })
        }</script>`
      )
    }
    res.end(indexHTML.tail)
    console.log(`whole request: ${Date.now() - s}ms`)
  })

  renderStream.on('error', err => {
    if (err && err.code === '404') {
      res.status(404).end('404 | Page Not Found')
      return
    }
    // Render Error Page or Redirect
    res.status(500).end('Internal Error 500')
    console.error(`error during render : ${req.url}`)
    console.error(err)
  })
})

const port = process.env.PORT || 3000
app.listen(port, () => {
  console.log(`server started at localhost:${port}`)
})