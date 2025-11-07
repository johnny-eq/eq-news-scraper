import { loadEnvFile } from 'node:process';
import puppeteer from 'puppeteer';
import * as path from "node:path";
import { dirname }  from 'path';
import { fileURLToPath } from 'url';
import { writeToPath } from '@fast-csv/format';
import fs from 'fs';
import { mkdir } from 'fs';
import { Readable } from 'stream';
import { finished } from "stream/promises";

loadEnvFile();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function getArticles(){
    const baseUrl = `${process.env.CLIENT_BASE_URL}news-centre/`;
    const pageQuery = 'query-34-page';
    const articleClass = '.wp-block-post';
    let pageNum = 1;
    const browser = await puppeteer.launch({
        slowMo: 20
    });
    const page = await browser.newPage();
    page.on('console', msg => {
        if (msg.text().indexOf('JQMIGRATE') !== -1) {
            return;
        }
        console.log(msg.text())
    });
    await page.goto(baseUrl);

    let articleData = [];
    let articleCount = await page.evaluate((selector) => {
        return document.querySelectorAll(selector).length;
    }, articleClass);

    while (articleCount > 0) {
        console.log("Evaluating page " + pageNum + '...');
        let articles = await page.evaluate((selector) => {
            const articleList = [];
            document.querySelectorAll(selector).forEach((article) => {
                articleList.push({
                    'short_title': article.querySelector('h5').innerText,
                    'url': article.querySelector('h5 > a').getAttribute('href')
                });
            });
            return articleList;
        }, articleClass);
        articles.forEach(article => {
            articleData.push(article);
        });

        // grab next set of articles
        pageNum++;
        await page.goto(baseUrl + '?' + pageQuery + '=' + pageNum);
        articleCount = await page.evaluate((selector) => {
            return document.querySelectorAll(selector).length;
        }, articleClass);
    }
    await browser.close();
    return articleData;
}

async function getArticleContent(articles) {
    const browser = await puppeteer.launch({
        slowMo: 150,
        timeout: 300000
    });
    const page = await browser.newPage();
    page.on('console', msg => {
        if (msg.text().indexOf('JQMIGRATE') !== -1) {
            return;
        }
        console.log(msg.text())
    });
    for (let i = 0; i < articles.length; i++) {
        const article = articles[i];
        const url = article.url;
        await page.goto(url);
        console.log('Grabbing page: ' + url);
        const links_list = await page.evaluate((selector) => {
            const article_links = document.querySelectorAll(selector);
            console.log('/////////////////////////////////');
            console.log('Checking for files from ' + article_links.length + ' links');
            const links = [];
            for (const link_tag of article_links.values()) {
                let link_url = link_tag.getAttribute('href');
                console.log('Evaluating link: ' + link_url);
                if (link_url.charAt(0) == '/') {
                    link_url = process.env.CLIENT_BASE_URL + link_url;
                }
                if (!link_url || links.indexOf(link_url) !== -1 || link_url.charAt(0) === '#' || link_url.indexOf('mailto:') !== -1) {
                    continue;
                }
                links.push(link_url);
            }
            console.log('/////////////////////////////////');
            return links;
        }, '.single-news-item a');
        console.log('Links found: ' + links_list.length);
        const file_names = [];
        for (let ind = 0; ind < links_list.length; ind++) {
            let link_url = links_list[ind];
            console.log('Checking link: ' + link_url);
            try {
                let res = await fetch(link_url);
                if (res.status !== 200 || res.headers.get('content-type').indexOf('text/html') !== -1) {
                    continue;
                }
                let file_name = new URL(link_url).pathname.split('/').pop();
                file_names.push(file_name);
                const download_dir = `downloads-${process.env.CLIENT_NAME}`;
                if (!fs.existsSync(download_dir)) await mkdir(download_dir);
                const destination = path.resolve(`./${download_dir}`, file_name);
                if (!fs.existsSync(destination)) {
                    const fileStream = fs.createWriteStream(destination, {flags: 'wx'});
                    await finished(Readable.fromWeb(res.body).pipe(fileStream));
                }
            } catch (err) {
                console.error('!!!!!!!!!!!! !!!!!!!!!!');
                console.error('Error fetching link: ' + link_url);
                console.error(err);
                console.error('!!!!!!!!!!!!!!!!!!!!!!');
            }
        }
        console.log('Files found: ' + file_names.length);
        let title = await page.evaluate((selector) => {
            const full_title_el = document.querySelector(selector);
            if (full_title_el) {
                return full_title_el.innerText;
            }
        }, '.single-news-item h1');
        article.title = title ? title : article.short_title;
        articles.files = file_names;
        articles[i] = article;
    };

    await browser.close();
    return articles;
}

let articleInfo = await getArticles();
console.log('Articles found: ' + articleInfo.length);
articleInfo = await getArticleContent(articleInfo);
const csvData = [];
const csvHeaders = ['title', 'short_title', 'files'];
csvData.push(csvHeaders);

articleInfo.forEach((article) => {
    if (!article.files) {
        return;
    }
    csvData.push([
        article.title,
        article.short_title,
        article.files,
    ]);
});
writeToPath(path.resolve(__dirname, 'news_pdfs_export.csv'), csvData)
    .on('error', err => console.error(err))
    .on('finish', () => console.log('Done writing.'));