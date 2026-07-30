import { createClient } from '@supabase/supabase-js';

// 1. Initialize Supabase with Admin/Service Role Key to bypass RLS and speed up writes
const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Error: Supabase credentials missing');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false }
});

const animalKingdomGroups = [
  'Carnivora', 'Primate', 'Rodentia', 'Chiroptera', 'Cetartiodactyla', 'Perissodactyla', 'Passeriformes', 'Accipitriformes', 'Psittaciformes',
  'Squamata', 'Testudines', 'Anura', 'Caudata',
  'Actinopterygii', 'Chondrichthyes', 'Echinodermata', 'Cnidaria', 'Porifera',
  'Coleoptera', 'Lepidoptera', 'Hymenoptera', 'Diptera', 'Odonata', 'Araneae',
  'Gastropoda', 'Bivalvia', 'Malacostraca', 'Annelida'
];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchAndSavePapers(speciesId, scientificName) {
  try {
    const crossrefUrl = `https://api.crossref.org/works?query=${encodeURIComponent(scientificName)}&rows=3`;
    const response = await fetch(crossrefUrl, {
      headers: {
        'User-Agent': 'WildlifeDatabase/1.0 (mailto:research@wildlifedatabase.local)'
      }
    });

    if (!response.ok) return;

    const data = await response.json();
    const items = data.message?.items || [];

    for (const item of items) {
      const title = item.title?.[0];
      const journal = item['container-title']?.[0] || 'Scientific Journal';
      const year = item.published?.['date-parts']?.[0]?.[0] || null;
      const url = item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : null);

      if (title && url) {
        // Use upsert or check existing
        const { error } = await supabase.from('publications').upsert([{
          species_id: speciesId,
          title: title,
          journal: journal,
          year: year,
          url: url
        }], { onConflict: 'species_id,url' });

        if (error) {
          console.warn(`⚠️ Publication insert error:`, error.message);
        }
      }
    }
  } catch (err) {
    console.warn(` ⚠️ Could not fetch literature for ${scientificName}`);
  }
}

async function importSpeciesForTerm(query) {
  const perPage = 100; // Balanced batch size
  const maxPages = 2;  // Reduced depth for a faster, cleaner initial run

  console.log(`\n🔍 Scanning group: "${query}"...`);

  for (let page = 1; page <= maxPages; page++) {
    const url = `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(query)}&rank=species&per_page=${perPage}&page=${page}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        if (response.status === 429) {
          console.warn(` ⚠️ Rate limit hit. Backing off...`);
          await delay(5000);
          continue;
        }
        break;
      }

      const data = await response.json();
      const results = data.results || [];
      if (results.length === 0) break;

      for (const taxon of results) {
        const commonName = taxon.preferred_common_name || taxon.name;
        const scientificName = taxon.name;
        const imageUrl = taxon.default_photo?.medium_url || taxon.default_photo?.square_url || 'https://images.unsplash.com/photo-1534567153574-2b12153a87f0?auto=format&fit=crop&w=800&q=80';
        
        const description = taxon.wikipedia_summary 
          ? taxon.wikipedia_summary 
          : `Comprehensive ecological profile for ${commonName} (${scientificName}).`;

        let conservationStatus = 'Not Evaluated';
        if (taxon.conservation_status?.status_name) {
          conservationStatus = taxon.conservation_status.status_name;
        } else if (Array.isArray(taxon.conservation_statuses) && taxon.conservation_statuses.length > 0) {
          const iucnRecord = taxon.conservation_statuses.find(s => s.authority === 'IUCN') || taxon.conservation_statuses[0];
          if (iucnRecord?.status_name) conservationStatus = iucnRecord.status_name;
        } else if (taxon.extinct) {
          conservationStatus = 'Extinct';
        }

        let familyName = query;
        if (taxon.ancestors && Array.isArray(taxon.ancestors)) {
          const familyObj = taxon.ancestors.find(a => a.rank === 'family');
          if (familyObj?.name) familyName = familyObj.name;
        }

        if (!commonName || !scientificName) continue;

        // Upsert species directly using scientific_name as unique key
        const { data: savedSpecies, error: speciesError } = await supabase
          .from('species')
          .upsert([{
            common_name: commonName,
            scientific_name: scientificName,
            description: description,
            conservation_status: conservationStatus,
            family: familyName,
            image_url: imageUrl
          }], { onConflict: 'scientific_name' })
          .select('id')
          .single();

        if (speciesError) {
          console.error(`❌ Species error for ${scientificName}:`, speciesError.message);
          continue;
        }

        if (savedSpecies?.id) {
          await fetchAndSavePapers(savedSpecies.id, scientificName);
          await delay(100); 
        }
      }

      await delay(500);
    } catch (err) {
      console.error(`❌ Error fetching "${query}" on page ${page}:`, err.message);
    }
  }
}

async function main() {
  for (const term of animalKingdomGroups) {
    await importSpeciesForTerm(term);
  }
  console.log('\n🎉 Sync complete and optimized!');
}

main();