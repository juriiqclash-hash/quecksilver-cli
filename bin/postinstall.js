#!/usr/bin/env node
// Runs automatically right after `npm install -g quecksilver-cli` finishes,
// so people aren't left staring at a blank terminal wondering what to do next.

console.log('');
console.log('QueckSilver CLI installed!');
console.log('');
console.log('Get started:');
console.log('  quecksilver              Start chatting (will prompt you to log in)');
console.log('  quecksilver login        Log in or switch accounts');
console.log('  quecksilver logout       Log out');
console.log('  quecksilver -f <file>    Attach a local file to your question');
console.log('  quecksilver --json       Machine-readable output for scripting');
console.log('  quecksilver usage        See your plan and rate limits');
console.log('  quecksilver config       See/change settings (e.g. autoOpen)');
console.log('');
console.log('Every tool works as both a start flag and a /command once chatting:');
console.log('  --search / /search       Force a web search');
console.log('  --image / /image         Generate or edit an image');
console.log('  --doc / /doc             Generate a document (docx/xlsx/pptx/pdf/markdown/csv)');
console.log('  --music / /music         Generate a short music track');
console.log('');