const BING_SITE_AUTH_XML = `<?xml version="1.0"?>
<users>
	<user>5ED3C9DEB000BDE4F0BE12E53889218C</user>
</users>`;

export function GET() {
  return new Response(BING_SITE_AUTH_XML, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=0, must-revalidate"
    }
  });
}
