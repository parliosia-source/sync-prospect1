// PATCH: KB sector matching logic
// Replace lines 377-389 in runProspectSearch.js with:

         // STRICT sector matching: use industrySectors from KB (structured, not tags)
         let matchedSectors = [];
         if (hasRequiredSectors) {
           const kbSectors = Array.isArray(kb.industrySectors) ? kb.industrySectors : [];
           matchedSectors = kbSectors.filter(s => campaign.industrySectors.includes(s));
           if (matchedSectors.length === 0) {
             if (kbSectors.length === 0) kbTopupRejectedMissingTagsCount++;
             else kbTopupRejectedSectorCount++;
             continue;
           }
         } else {
           matchedSectors = (Array.isArray(kb.industrySectors) && kb.industrySectors.length > 0) ? kb.industrySectors : [];
         }