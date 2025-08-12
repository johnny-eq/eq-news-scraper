import puppeteer from 'puppeteer';
import * as path from "node:path";
import { dirname }  from 'path';
import { fileURLToPath } from 'url';
import { writeToPath } from '@fast-csv/format';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function getArticles(){
    const baseUrl = 'https://www.ardaghgroup.com/news-centre/';
    const pageQuery = 'query-34-page';
    const articleClass = '.wp-block-post';
    let pageNum = 1;
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
        console.log("Evaluating page " + pageNum + '...');
        let articles = await page.evaluate((selector) => {
            const tagList = {
                'category-agp-africa': 'Africa',
                'category-agp-north-america': 'Americas',
                'category-ardagh-for-education': 'Ardagh for Education',
                'category-awards': 'Awards',
                'category-beer': 'Beer',
                'category-beverages': 'Beverage Cans',
                'category-centre-of-excellence': 'Centre of Excellence',
                'category-cider': 'Cider',
                'category-europe': 'Europe',
                'category-group': 'Group',
                'category-food': 'Food',
                'category-innovation': 'Innovation',
                'category-nabs': 'FABs/NABs',
                'category-spirits': 'Spirits',
                'category-sustainability': 'Sustainability',
                'category-wine': 'Wine'
            }
            const articleList = [];
            document.querySelectorAll(selector).forEach((article) => {
                let classes = article.classList;
                const articleTags = [];
                classes.forEach((className) => {
                    if (className.indexOf('category') !== -1) {
                        if (Object.hasOwn(tagList, className)) {
                            articleTags.push(tagList[className]);
                        }
                    }

                });
                const date = new Date(article.querySelector('time').innerText);
                articleList.push({
                    'title': article.querySelector('h5').innerText,
                    'url': article.querySelector('h5 > a').getAttribute('href'),
                    'thumbnail': article.querySelector('img').getAttribute('src'),
                    'publish_date': date.getFullYear() + '-' + ('0' + (date.getMonth() + 1)).slice(-2) + '-' + ('0' + (date.getDate())).slice(-2),
                    'tags': articleTags
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
const csvHeaders = ['title', 'thumbnail', 'publish_date', 'content', 'tags'];
csvData.push(csvHeaders);
articleInfo.forEach((article) => {
    csvData.push([
        article.title,
        article.thumbnail,
        article.publish_date,
        article.content,
        article.tags
    ]);
});
writeToPath(path.resolve(__dirname, 'news_export.csv'), csvData)
    .on('error', err => console.error(err))
    .on('finish', () => console.log('Done writing.'));