import puppeteer from 'puppeteer';
import * as path from "node:path";
import { dirname }  from 'path';
import { fileURLToPath } from 'url';
import { writeToPath } from '@fast-csv/format';
import fs from 'fs';
import { mkdir } from 'fs';
import { Readable } from 'stream';
import { finished } from 'stream/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Insite API Info
const target_db = process.env.INSITE_TARGET_DB;
const api_base_url = `${process.env.INSITE_API_URL}${process.env.CLIENT_NAME}/`;
const auth_token = process.env.INSITE_AUTH_TOKEN;

// TODO: integrate the file grabbing and link fixing scripts into the initial import

async function getArticles(){
    const baseUrl = `${process.env.CLIENT_BASE_URL}/ news-centre/`;
    const pageQuery = 'query-34-page';
    const articleClass = '.wp-block-post';
    let pageNum = 1;
    const browser = await puppeteer.launch({
        slowMo: 70
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
                let src = article.querySelector('img').getAttribute('src');
                if (src.indexOf('https://www.ardaghgroup.com') === -1) {
                    src = 'https://www.ardaghgroup.com' + src;
                }
                articleList.push({
                    'short_title': article.querySelector('h5').innerText,
                    'url': article.querySelector('h5 > a').getAttribute('href'),
                    'thumbnail': src,
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
        let title = await page.evaluate((selector) => {
            const full_title_el = document.querySelector(selector);
            if (full_title_el) {
                return full_title_el.innerText;
            }
        }, '.single-news-item h1');
        article.content = content ? content : "" ;
        article.title = title ? title : article.short_title;
        articles[i] = article;
    };

    await browser.close();
    return articles;
}

async function storeArticleToInsite(article) {
    const body = {
        data: {
            table_id: target_db,
            data: {
                title: article.title,
                short_title: article.short_title,
                thumbnail: {
                    url: article.thumbnail // TODO: investigate why the API is not accepting the image URL
                },
                thumbnail_url: article.thumbnail,
                published_at: article.publish_date,
                tags: article.tags,
                tag_list: article.tags.toString(),
                content: article.content
            }
        }
    }
    return fetch(
        `${api_base_url}/tables/${target_db}/records`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${auth_token}`,
            },
            body: JSON.stringify(body)
        }
    );
}

async function getImage(url, fileName)  {
    const res = await fetch(url);
    if (!fs.existsSync("images")) await mkdir("images");
    const destination = path.resolve("./images", fileName);
    const fileStream = fs.createWriteStream(destination, { flags: 'wx' });
    return await finished(Readable.fromWeb(res.body).pipe(fileStream));
}

let articleInfo = await getArticles();
console.log('Articles found: ' + articleInfo.length);
articleInfo = await getArticleContent(articleInfo);
const csvData = [];
const csvHeaders = ['title', 'short_title', 'thumbnail', 'published_at', 'content', 'tags'];
csvData.push(csvHeaders);

articleInfo.forEach((article) => {
    csvData.push([
        article.title,
        article.short_title,
        article.thumbnail,
        article.publish_date,
        article.content,
        article.tags
    ]);

    // Write records to Insite
    storeArticleToInsite(article).then((result) => {
        if (result.ok) {
            console.log(`Article: "${article.title}" added`);
        } else {
            console.error(`Error for Article: "${article.title}"`);
        }
    });
});
writeToPath(path.resolve(__dirname, 'news_export.csv'), csvData)
    .on('error', err => console.error(err))
    .on('finish', () => console.log('Done writing.'));