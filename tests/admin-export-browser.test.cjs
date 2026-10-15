// Start backend/tests/translation_browser_server.py before running this test.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const base=process.env.MCSA_ADMIN_TEST_URL||'http://127.0.0.1:8766';

test('CMS export download, dirty guard and recoverable errors keep the editor usable',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.MCSA_BROWSER_EXECUTABLE||undefined});
  const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(base+'/admin.html');
    await page.locator('[name=password]').fill('browser-translation-test');
    await page.locator('.cms-login button').click();
    const button=page.locator('#export-public');await button.waitFor();
    const download=page.waitForEvent('download');await button.click();
    assert.equal((await download).suggestedFilename(),'MCSA-public-static-source.zip');
    await page.waitForFunction(()=>document.querySelector('#cms-status').textContent.includes('公开内容包已下载'));
    await page.route('**/api/admin/static-export',route=>route.fulfill({status:409,json:{error:'export_missing_media',files:['media/missing.png']}}));
    await button.click();
    await page.waitForFunction(()=>document.querySelector('#cms-status').textContent.includes('图片缺失'));
    assert.match(await page.locator('#cms-status').innerText(),/media\/missing.png/);
    assert.equal(await button.isEnabled(),true);
    await page.locator('#add-entry').click();
    await button.click();
    assert.match(await page.locator('#cms-status').innerText(),/请先保存中文修改/);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
