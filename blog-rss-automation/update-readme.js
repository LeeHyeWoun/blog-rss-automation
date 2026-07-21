/**
 * @file update-readme.js
 * @description 네이버 블로그 RSS를 파싱하여 기존 README.md 내용을 유지하면서
 *              신규 포스팅만 지속적으로 누적(Append) 업데이트하는 자동화 스크립트.
 * @author LeeHyeWoun <abc@kakao.com>
 */

const fs = require('fs');
const path = require('path');
const Parser = require('rss-parser');

/** @type {Parser} rss-parser 인스턴스 (네이버 RSS의 category 필드 파싱 설정 추가) */
const parser = new Parser({
    customFields: {
        item: ['category'],
    },
});

/** @const {string} 네이버 블로그 사용자 ID */
const NAVER_ID = 'silro812';

/** @const {string} 네이버 블로그 RSS 피드 URL */
const RSS_URL = `https://rss.blog.naver.com/${NAVER_ID}.xml`;

/** @const {string} 타겟 README.md 파일의 절대 경로 */
const README_PATH = path.join(__dirname, '../README.md');

/** @const {string} 히스토리 상태(State) 저장용 JSON 파일의 절대 경로 */
const HISTORY_PATH = path.join(__dirname, 'blog-history.json');

/**
 * 한국 표준시(KST, UTC+9) 기준의 포맷팅된 현재 날짜/시간 문자열을 반환합니다.
 * 
 * @returns {string} 포맷팅된 날짜 문자열 (e.g., "2026-07-21 12:00:00 (KST)")
 */
function getFormattedDate() {
    const now = new Date();
    const kstOffset = 9 * 60; // KST는 UTC+9
    const kstDate = new Date(now.getTime() + (now.getTimezoneOffset() + kstOffset) * 60000);

    const pad = (n) => String(n).padStart(2, '0');
    const yyyy = kstDate.getFullYear();
    const mm = pad(kstDate.getMonth() + 1);
    const dd = pad(kstDate.getDate());
    const hh = pad(kstDate.getHours());
    const mi = pad(kstDate.getMinutes());
    const ss = pad(kstDate.getSeconds());

    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss} (KST)`;
}

/**
 * 네이버 블로그 PC 주소를 구글 크롤러 수집에 유용한 모바일 주소로 변환합니다.
 * 
 * @param {string} link - 네이버 블로그 원본 PC URL (e.g., https://blog.naver.com/id/123)
 * @returns {string} 모바일로 변환된 URL (e.g., https://m.blog.naver.com/id/123)
 */
function transformToMobileUrl(link) {
    if (!link) return '';
    return link.replace('blog.naver.com', 'm.blog.naver.com');
}

/**
 * 기존 히스토리 파일(blog-history.json)을 로드하여 이미 수집된 URL 목록을 Set 구조로 반환합니다.
 * 파일이 존재하지 않거나 파싱 에러 발생 시 빈 Set을 생성합니다.
 * 
 * @returns {Set<string>} 수집 완료된 모바일 URL들의 집합
 */
function loadHistory() {
    if (fs.existsSync(HISTORY_PATH)) {
        try {
            const data = fs.readFileSync(HISTORY_PATH, 'utf-8');
            return new Set(JSON.parse(data));
        } catch (e) {
            console.warn('[Warn] 히스토리 파일 파싱 실패. 새로운 Set을 초기화합니다.');
        }
    }
    return new Set();
}

/**
 * 업데이트된 URL 히스토리 집합을 JSON 파일로 영속화(Persistence)합니다.
 * 
 * @param {Set<string>} historySet - 저장할 URL 집합
 * @returns {void}
 */
function saveHistory(historySet) {
    const data = JSON.stringify(Array.from(historySet), null, 2);
    fs.writeFileSync(HISTORY_PATH, data, 'utf-8');
}

/**
 * RSS를 수집하고, 신규 포스팅만 감지하여 README.md에 누적 업데이트하는 메인 파이프라인 함수.
 * 
 * @async
 * @returns {Promise<void>}
 */
async function updateReadmeWithAccumulation() {
    try {
        // ==========================================
        // [Step 1] RSS Feed 수집 및 히스토리 로드
        // ==========================================
        //console.log(`[Fetch] RSS 피드 수집 시작: ${RSS_URL}`);
        const feed = await parser.parseURL(RSS_URL);

        /** @type {Set<string>} 기존 수집 완료된 URL Set */
        const visitedUrls = loadHistory();

        /** @type {Object.<string, Array<{title: string, url: string}>>} 카테고리별 신규 포스팅 객체 */
        const newItemsByCategory = {};
        let newItemsCount = 0;

        // ==========================================
        // [Step 2] RSS 항목 중 신규 포스팅 필터링 및 디버그 출력
        // ==========================================
        feed.items.forEach((item) => {
            const mobileUrl = transformToMobileUrl(item.link);

            // 이미 히스토리에 존재하는 URL인 경우 스킵 (중복 방지)
            if (!visitedUrls.has(mobileUrl)) {
                const category = item.category || '기타';
                const title = item.title ? item.title.trim() : '제목 없음';

                if (!newItemsByCategory[category]) {
                    newItemsByCategory[category] = [];
                }

                newItemsByCategory[category].push({ title, url: mobileUrl });
                visitedUrls.add(mobileUrl); // 메모리 상태에 신규 URL 추가
                newItemsCount++;
            }
        });

        // ==========================================
        // [Step 3] 신규 포스팅 유무 확인 및 감지 내역 출력
        // ==========================================
        if (newItemsCount === 0) {
            //console.log(`[Info] [${getFormattedDate()}] 새로운 블로그 포스팅이 없습니다. README 업데이트를 스킵합니다.`);
            return;
        }

        console.log(`\n[Detect] 총 ${newItemsCount}개의 신규 포스팅이 감지되었습니다:`);
        for (const [categoryName, posts] of Object.entries(newItemsByCategory)) {
            console.log(`  📌 [카테고리: ${categoryName}]`);
            posts.forEach((post) => {
                console.log(`     - ${post.title} (${post.url})`);
            });
        }
        console.log('');

        // ==========================================
        // [Step 4] 기존 README.md 내용 읽기
        // ==========================================
        let existingReadme = '';
        if (fs.existsSync(README_PATH)) {
            existingReadme = fs.readFileSync(README_PATH, 'utf-8');
        }

        // ==========================================
        // [Step 5] 신규 항목에 대한 Markdown 백링크 렌더링
        // ==========================================
        let appendMarkdown = '\n\n';
        for (const [categoryName, posts] of Object.entries(newItemsByCategory)) {
            // 기존 README에 해당 카테고리 헤더가 없는 경우에만 헤더(#) 생성
            if (!existingReadme.includes(`# 카테고리: ${categoryName}`)) {
                appendMarkdown += `# 카테고리: ${categoryName}\n\n`;
            }

            // [제목](모바일URL) 마크다운 백링크 생성
            posts.forEach((post) => {
                appendMarkdown += `- [${post.title}](${post.url})\n`;
            });
            appendMarkdown += '\n';
        }

        // ==========================================
        // [Step 6] README.md에 덧붙이기(Append) 및 히스토리 파일 저장
        // ==========================================
        fs.writeFileSync(README_PATH, existingReadme + appendMarkdown, 'utf-8');
        saveHistory(visitedUrls);

        console.log(`[Success] [${getFormattedDate()}] README.md 및 blog-history.json 업그레이드가 성공적으로 완료되었습니다!`);
    } catch (error) {
        console.error(`[Error] [${getFormattedDate()}] 파이프라인 실행 중 오류 발생:`, error);
        process.exit(1);
    }
}

// 스크립트 실행
updateReadmeWithAccumulation();