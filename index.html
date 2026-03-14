// api/ytsearch.js — Vercel Serverless Function
// Scrapes YouTube's own search page (ytInitialData) server-side.
// No API key. No CORS. Free forever on Vercel hobby plan.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const q = req.query.q;
  if (!q) return res.status(400).json({ error: 'missing q' });

  try {
    const url = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q) + '&sp=EgIQAQ%253D%253D';
    const html = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      }
    }).then(r => r.text());

    // Extract ytInitialData JSON from the page
    const match = html.match(/var ytInitialData = ({.+?});<\/script>/s);
    if (!match) return res.status(502).json({ error: 'could not parse YouTube response' });

    const data = JSON.parse(match[1]);

    // Navigate to video results
    const contents =
      data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
          ?.sectionListRenderer?.contents?.[0]
          ?.itemSectionRenderer?.contents || [];

    const videos = [];
    for (const item of contents) {
      const v = item.videoRenderer;
      if (!v || !v.videoId) continue;

      const title     = v.title?.runs?.[0]?.text || '';
      const channel   = v.ownerText?.runs?.[0]?.text || '';
      const duration  = v.lengthText?.simpleText || '';
      const thumb     = `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`;
      const views     = v.viewCountText?.simpleText || '';

      videos.push({ videoId: v.videoId, title, channel, duration, thumb, views });
      if (videos.length >= 8) break;
    }

    res.status(200).json(videos);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
