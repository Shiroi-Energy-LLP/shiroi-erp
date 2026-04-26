const fs = require('fs');
const path = require('path');

const inputFile = process.argv[2];
const outputFile = process.argv[3];

const raw = fs.readFileSync(inputFile, 'utf-8');
const arr = JSON.parse(raw);
const inner = JSON.parse(arr[0].text);
fs.writeFileSync(outputFile, inner.types, 'utf-8');
console.log('Wrote', inner.types.length, 'chars to', outputFile);
