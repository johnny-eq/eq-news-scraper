import puppeteer from 'puppeteer';
import * as path from "node:path";
import { dirname }  from 'path';
import { fileURLToPath } from 'url';
import { writeToPath } from '@fast-csv/format';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function getArticles(){
    const baseUrl = 'https://www.ardaghgroup.com/press-releases/';
    const pageQuery = 'filtered-';
    const articleClass = '.press-release-row';
    let pageNum = 2025;
    const browser = await puppeteer.launch({
        slowMo: 150
    });
    const page = await browser.newPage();
    await page.goto(baseUrl);

    let articleData = [];
    let articleCount = await page.evaluate((selector) => {
        return document.querySelectorAll(selector).length;
    }, articleClass);

    while (articleCount > 0) {
        console.log("Evaluating page " + baseUrl + pageQuery + pageNum);
        let articles = await page.evaluate((selector) => {
            const articleList = [];
            document.querySelectorAll(selector).forEach((article) => {
                let date;
                const resources = Array(5).fill('');
                const resource_row = article.querySelectorAll('.resources-row a');
                article.querySelectorAll('p').forEach((paragraph) => {
                    let date_text = paragraph.innerText;
                    let cutoff_index = date_text.indexOf('Date published: ');
                    if (cutoff_index !== -1) {
                        date = new Date(date_text.substring(cutoff_index + 1));
                    }
                });
                resource_row.forEach((resource, index) => {
                    resources[index] = resource.getAttribute('href');
                });
                articleList.push({
                    'title': article.querySelector('h2').innerText,
                    'url': article.querySelector('h2 a').getAttribute('href'),
                    'publish_date': date ? date.getFullYear() + '-' + ('0' + (date.getMonth() + 1)).slice(-2) + '-' + ('0' + (date.getDate())).slice(-2) : '',
                    'resource_1': resources[0],
                    'resource_2': resources[1],
                    'resource_3': resources[2],
                    'resource_4': resources[3],
                    'resource_5': resources[4],
                });
            });
            return articleList;
        }, articleClass);
        articles.forEach(article => {
            articleData.push(article);
        });

        // grab next set of articles
        pageNum--;
        await page.goto(baseUrl + pageQuery + pageNum);
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
    for (let i = 0; i < articles.length; i++) {
        const article = articles[i];
        const url = article.url;
        await page.goto(url);
        console.log('Grabbing page ' + url);
        let content = await page.evaluate((selector) => {
            const paragraphs = document.querySelectorAll(selector);
            if (!paragraphs) {
                return false;
            }
            let articleText = '';
            paragraphs.forEach((paragraph) => {
                if (paragraph.innerText.indexOf('Published: ') !== -1) {
                    return;
                }
                articleText += paragraph.outerHTML.replace('https://www.ardaghgroup.com', '');
            });
            return articleText;
        }, '.single-news-item p');
        article.content = content;
        articles[i] = article;
    };

    await browser.close();
    return articles;
}

let articleInfo = await getArticles();
console.log('Articles found: ' + articleInfo.length);
articleInfo = await getArticleContent(articleInfo);
const csvData = [];
const csvHeaders = ['title', 'published_at', 'content', 'resource_1', 'resource_2', 'resource_3', 'resource_4', 'resource_5'];
csvData.push(csvHeaders);
articleInfo.forEach((article) => {
    csvData.push([
        article.title,
        article.publish_date,
        article.content,
        article.resource_1,
        article.resource_2,
        article.resource_3,
        article.resource_4,
        article.resource_5,
    ]);
});
writeToPath(path.resolve(__dirname, 'press_releaes_export.csv'), csvData)
    .on('error', err => console.error(err))
    .on('finish', () => console.log('Done writing.'));