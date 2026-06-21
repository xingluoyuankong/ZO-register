/**
 * Phase 1: 发邮件 + 轮询获取魔法链接
 * Usage: node phase1-link.cjs <email-file>
 */
const fs = require('fs');
const pptr = require('puppeteer-extra');
const Stealth = require('puppeteer-extra-plugin-stealth');
pptr.use(Stealth());
const sleep = ms => new Promise(r => setTimeout(r, ms));

const file = process.argv[2];
if (!file) { console.error('Usage: node phase1-link.cjs <email-file>'); pr