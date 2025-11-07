import { loadEnvFile } from 'node:process';
import { JSDOM } from 'jsdom';
import fs from 'fs';

loadEnvFile();
// Insite API Info
const target_db = process.env.INSITE_TARGET_DB;
const api_base_url = `${process.env.INSITE_API_URL}${process.env.CLIENT_NAME}/`;
const auth_token = process.env.INSITE_AUTH_TOKEN;
const insite_file_url = process.env.INSITE_FILE_DIR;
const client_base_url = process.env.CLIENT_BASE_URL;
const download_dir = `downloads-${process.env.CLIENT_NAME}`;

async function get_insite_articles() {
    console.log('Grabbing first page of articles...');
    let data;
    let res = await fetch(
        `${api_base_url}/tables/${target_db}/records`,
        {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${auth_token}`,
            }
        }
    );
    if (!res.status === 200) {
        return null;
    }
    let first_response = await res.json();
    const total_pages = first_response.meta.pagination.total_pages;
    console.log(`${total_pages} pages reported for ${first_response.meta.pagination.total_count} articles.`);
    if (total_pages === 1) {
        return first_response.data;
    }
    data = first_response.data;
    for (let page = 2; page <= total_pages; page++) {
        console.log(`Grabbing articles from page ${page}`);
        res = await fetch(
            `${api_base_url}/tables/${target_db}/records?page=${page}`,
            {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${auth_token}`,
                }
            }
        );
        if (!res.status === 200) {
            continue;
        }
        let new_data = await res.json();
        data = data.concat(new_data.data);
    }
    return data;
}

async function get_file_list() {
    const file_list = [];
    if (!fs.existsSync(download_dir)) {
        throw Error(`Download directory '${download_dir}' doesn't exist`);
    }
    const files = fs.readdirSync(download_dir);
    for (let file of files) {
        file_list.push(file);
    }
    return file_list;
}

async function replace_file_links(record, file_list) {
    const content = record.data.content;
    if (!content) {
        return false;
    }
    const dom = new JSDOM(`<!DOCTYPE html>${content}`);
    const links = dom.window.document.querySelectorAll("a");
    let replace_counter = 0;
    for (const link of links) {
        let href = link.getAttribute("href");
        if (!href || href.charAt(0) === '#' || href.indexOf('mailto:') !== -1 || href.indexOf('cloudfront.net') !== -1) {
            continue;
        }
        if (href.charAt(0) === '/') {
            href = client_base_url + href;
        }
        const last_url_part = new URL(href).pathname.split('/').pop();
        if (!last_url_part.endsWith('.pdf') && !last_url_part.endsWith('.jpg')) {
            continue;
        }
        if (file_list.indexOf(last_url_part) === -1) {
            continue;
        }
        replace_counter++;
        link.setAttribute("href", `${insite_file_url}${last_url_part}`);
    }
    if (replace_counter === 0) {
        return false;
    }
    const fixed_content = dom.window.document.querySelector('body').innerHTML;
    console.log(`Patching article ${record.id}: ${record.data.title}`);
    let replace_res = await replace_insite_content(record, fixed_content);
    if (replace_res.status === 200) {
        console.log(`Success!`);
    } else {
        console.error('!!!!!!!!!!!!!!!!');
        console.error(`Error patching article`);
        console.error('!!!!!!!!!!!!!!!!');
    }
}

async function replace_insite_content(record, content) {
    const body = {
        data: {
            data: {
                content: content
            }
        }
    }
    return fetch(
        `${api_base_url}/tables/${target_db}/records/${record.id}`,
        {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${auth_token}`,
            },
            body: JSON.stringify(body)
        }
    );
}

try {
    const records = await get_insite_articles();
    const file_list = await get_file_list();
    for (const record of records) {
        await replace_file_links(record, file_list);
    }
} catch (err) {
    console.error('!!!!!!!!!!!!!!!!');
    console.error(err);
    console.error('!!!!!!!!!!!!!!!!');
}
