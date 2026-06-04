/**
 * ZO Computer 批量注册 - Linux v3 (stealth)
 */
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { readFileSync, appendFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } = require('fs');
const { join } = require