const express = require('express')
const app = express()

app.use(express.json())

app.get('/', (req, res) => {
  res.json({ message: 'hello from inside the VM!' })
})

app.get('/ping', (req, res) => {
  res.json({ pong: true, time: new Date().toISOString() })
})

app.post('/echo', (req, res) => {
  res.json({ echo: req.body })
})

const port = process.env.PORT || 3000
app.listen(port, () => {
  console.log(`app listening on port ${port}`)
})
