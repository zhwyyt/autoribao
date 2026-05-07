const { queryProjectComponentDetails } = require('./src/project-component-details');

async function main() {
  const text = process.argv.slice(2).join(' ').trim() || '项目构件详情 构件编号=1-D1GZ-1';
  const result = await queryProjectComponentDetails(text);
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
