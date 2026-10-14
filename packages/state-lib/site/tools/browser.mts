/** Browser harnesses are offline-deterministic. Only the optional external font
 * stylesheet is replaced with empty CSS; local assets and application/network
 * errors are NOT suppressed. Browser rendering uses the normal font fallbacks. */
import {chromium as actual, type BrowserContext, type Page} from 'playwright';
const fonts=async(target:BrowserContext|Page)=>target.route('https://fonts.googleapis.com/**',route=>route.fulfill({status:200,contentType:'text/css',body:'/* Offline test: system font fallback. */'}));
export const chromium=Object.create(actual) as typeof actual;
chromium.launch=async(options)=>{
 const browser=await actual.launch({...options,args:[...(options?.args??[]),'--no-sandbox']});
 const newContext=browser.newContext.bind(browser),newPage=browser.newPage.bind(browser);
 browser.newContext=async(options)=>{const context=await newContext(options);await fonts(context);return context;};
 browser.newPage=async(options)=>{const page=await newPage(options);await fonts(page);return page;};
 return browser;
};
