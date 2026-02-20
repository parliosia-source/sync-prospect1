import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Fetch all KB entities (paginate if needed)
    let allEntities = [];
    let page = 0;
    const pageSize = 500;
    
    while (true) {
      const batch = await base44.asServiceRole.entities.KBEntity.list(
        '-updated_date',
        pageSize,
        page * pageSize
      ).catch(() => []);
      
      if (!batch || batch.length === 0) break;
      allEntities = allEntities.concat(batch);
      
      if (batch.length < pageSize) break;
      page++;
    }

    const total = allEntities.length;

    // Count by entityType
    const countByEntityType = {};
    allEntities.forEach(e => {
      const type = e.entityType || 'UNKNOWN';
      countByEntityType[type] = (countByEntityType[type] || 0) + 1;
    });

    // Count with/without industrySectors
    const withSectors = allEntities.filter(e => Array.isArray(e.industrySectors) && e.industrySectors.length > 0).length;
    const withoutSectors = total - withSectors;

    // Count by industrySector (all sectors mentioned)
    const countByIndustrySector = {};
    allEntities.forEach(e => {
      if (Array.isArray(e.industrySectors)) {
        e.industrySectors.forEach(sector => {
          countByIndustrySector[sector] = (countByIndustrySector[sector] || 0) + 1;
        });
      }
    });

    // Count by location (simple city parsing)
    const countByLocationCity = {};
    allEntities.forEach(e => {
      if (e.hqLocation) {
        // Simple parse: "City, Province/State, Country" => extract city
        const city = e.hqLocation.split(',')[0]?.trim();
        if (city) {
          countByLocationCity[city] = (countByLocationCity[city] || 0) + 1;
        }
      }
    });

    // Sort locations by count (desc)
    const sortedLocations = Object.entries(countByLocationCity)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .reduce((acc, [city, count]) => {
        acc[city] = count;
        return acc;
      }, {});

    const result = {
      totalKBEntities: total,
      countByEntityType,
      countWithIndustrySectors: withSectors,
      countMissingIndustrySectors: withoutSectors,
      countByIndustrySector: Object.fromEntries(
        Object.entries(countByIndustrySector).sort((a, b) => b[1] - a[1])
      ),
      countByLocationCity: sortedLocations,
      fetchedPages: page + 1,
      pageSize
    };

    return Response.json(result);
  } catch (error) {
    console.error('getKbStats error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});