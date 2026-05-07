const { handleProjectComponentDetailExport } = require('./src/project-component-details-db');

async function main() {
  const text = process.argv.slice(2).join(' ').trim() || '上海西岑文化艺术中心的构件详情';
  const result = await handleProjectComponentDetailExport(text);
  console.log('handled=', result && result.handled);
  console.log('count=', result && result.count);
  console.log('reply=');
  console.log(result && result.replyText);
  if (result && Array.isArray(result.files) && result.files.length > 0) {
    console.log('files=');
    for (const file of result.files) {
      console.log(file.path);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
