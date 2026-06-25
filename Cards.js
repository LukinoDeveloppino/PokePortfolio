// ════════════════════════════════════════════════════════════════════
// Cards.gs — CATALOGO CARTE (dati scaricati dall'API CardTrader)
// ════════════════════════════════════════════════════════════════════
// Questo file gestisce:
//   1. La SINCRONIZZAZIONE del catalogo: scarica da CardTrader la lista
//      delle espansioni (set) Pokémon e tutte le loro carte singole, e le
//      salva nei fogli SET_CACHE e CACHE_CARDS dell'utente.
//      La sync supporta la ripresa automatica ("cursor") perché le funzioni
//      Apps Script hanno un timeout massimo di 6 minuti.
//   2. La LETTURA del catalogo dalla cache (lista set, carte di un set,
//      ricerca per nome) — chiamata dal frontend.
//
// Nota terminologia CardTrader:
//   • "expansion" = un set di carte (es. "Scarlet & Violet 151")
//   • "blueprint" = una singola carta/prodotto all'interno di un set
// ════════════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════════
// COSTANTI
// ════════════════════════════════════════════════════════════════════

// URL base dell'API CardTrader v2 (usato anche da Prices.gs).
var URL_BASE_API_CARDTRADER = 'https://api.cardtrader.com/api/v2';

// Su CardTrader ogni gioco ha un ID numerico: 5 = Pokémon TCG.
var ID_GIOCO_POKEMON_SU_CARDTRADER = 5;

// Su CardTrader ogni prodotto ha una categoria: 73 = carta singola
// (esclude buste, box, accessori, ecc.).
var ID_CATEGORIA_CARTA_SINGOLA = 73;

// Espansioni da ESCLUDERE dalla sync (set vecchi, prodotti sealed,
// deck kit, promo non interessanti, ecc.).
// Logica: tutto ciò che NON è in questa blacklist viene incluso
// automaticamente — quindi anche i set futuri verranno scaricati senza
// dover toccare il codice.
var ID_ESPANSIONI_ESCLUSE = [
  1468, // Wizards of the Coast Era Promos
  1469, // Pokémon Products
  1470, // Miscellaneous Promos
  1471, // League Promos
  1472, // Base Set
  1473, // Jungle
  1474, // Wizards Black Star Promos
  1475, // W Promos
  1476, // Fossil
  1477, // Oversized Promos
  1478, // Base Set 2
  1479, // Team Rocket
  1480, // Gym Heroes
  1481, // Gym Challenge
  1482, // Neo Genesis
  1483, // Neo Discovery
  1484, // Southern Islands
  1485, // Neo Revelation
  1486, // Neo Destiny
  1487, // Legendary Collection
  1488, // Expedition Base Set
  1491, // Aquapolis
  1492, // Skyridge
  1493, // EX Ruby & Sapphire
  1494, // EX Sandstorm
  1496, // EX Dragon
  1498, // EX Trainer Kit
  1499, // EX Hidden Legends
  1500, // EX FireRed & LeafGreen
  1501, // POP Series 1
  1502, // EX Team Rocket Returns
  1503, // EX Deoxys
  1504, // EX Trainer Kit 2
  1505, // EX Emerald
  1506, // POP Series 2
  1507, // EX Unseen Forces
  1508, // EX Delta Species
  1509, // EX Legend Maker
  1510, // POP Series 3
  1511, // EX Holon Phantoms
  1512, // POP Series 4
  1513, // EX Crystal Guardians
  1514, // EX Dragon Frontiers
  1515, // EX Power Keepers
  1516, // POP Series 5
  1517, // DP Black Star Promos
  1518, // Diamond & Pearl
  1519, // Mysterious Treasures
  1520, // POP Series 6
  1521, // DP Trainer Kit
  1522, // Secret Wonders
  1523, // Great Encounters
  1524, // POP Series 7
  1525, // Majestic Dawn
  1526, // Burger King DP Promos 2008
  1527, // Legends Awakened
  1528, // POP Series 8
  1529, // Stormfront
  1530, // Platinum
  1531, // POP Series 9
  1532, // Rising Rivals
  1533, // Supreme Victors
  1535, // Pokémon Rumble
  1536, // HGSS Black Star Promos
  1537, // HeartGold & SoulSilver
  1538, // HS Trainer Kit
  1539, // Unleashed
  1540, // Undaunted
  1541, // Triumphant
  1542, // Call of Legends
  1543, // BW Black Star Promos
  1544, // Black & White
  1545, // McDonald's Collection 2011
  1546, // Emerging Powers
  1547, // BW Trainer Kit
  1548, // Noble Victories
  1549, // Next Destinies
  1551, // McDonald's Collection 2012
  1552, // Dragons Exalted
  1553, // Dragon Vault
  1554, // Boundaries Crossed
  1555, // Plasma Storm
  1556, // Plasma Freeze
  1557, // Plasma Blast
  1558, // XY Black Star Promos
  1559, // McDonald's Collection 2013
  1561, // XY Kalos Starter Set
  1562, // XY
  1563, // XY Trainer Kit
  1564, // Flashfire
  1565, // McDonald's Collection 2014
  1566, // Furious Fists
  1567, // XY Trainer Kit: Bisharp & Wigglytuff
  1568, // Phantom Forces
  1569, // Primal Clash
  1570, // Double Crisis
  1571, // XY Trainer Kit: Latias & Latios
  1572, // Roaring Skies
  1573, // Ancient Origins
  1574, // McDonald's Collection 2015
  1575, // BREAKthrough
  1576, // BREAKpoint
  1577, // Generations
  1578, // XY Trainer Kit: Pikachu Libre & Suicune
  1579, // Fates Collide
  1580, // Steam Siege
  1581, // McDonald's Collection 2016
  1586, // Evolutions
  1587, // SM Black Star Promos
  1588, // Sun & Moon
  1589, // SM Trainer Kit: Lycanroc & Alolan Raichu
  1590, // Guardians Rising
  1591, // McDonald's Collection 2017
  1594, // Crimson Invasion
  1599, // Ultra Prism
  1600, // Forbidden Light
  1601, // SM Trainer Kit: Alolan Sandslash & Alolan Ninetales
  1602, // McDonald's Collection 2018
  1603, // Celestial Storm
  1604, // Dragon Majesty
  1606, // Lost Thunder
  1611, // Team Up
  1612, // Detective Pikachu
  1613, // Unbroken Bonds
  1614, // Unified Minds
  1615, // Hidden Fates
  1616, // McDonald's Collection 2019
  1617, // Cosmic Eclipse
  1635, // Cosmic Eclipse Promos
  1646, // Sword & Shield Merchandise
  1647, // S-P: Sword & Shield Promos
  1648, // Sun & Moon Merchandise
  1649, // SM-P: Sun & Moon Promos
  1853, // EX Team Magma vs Team Aqua
  1860, // Unown sub-set Unseen Forces
  1868, // Diamond & Pearl Promos
  1869, // Mysterious Treasures Promos
  1870, // Secret Wonders Promos
  1873, // Legends Awakened Promos
  1874, // Stormfront Promos
  1876, // Rising Rivals Promos
  1877, // Supreme Victors Promos
  1878, // Platinum Arceus
  1880, // HeartGold & SoulSilver Promos
  1883, // Triumphant Promos
  1884, // Call of Legends Promos
  1887, // Noble Victories Promos
  1888, // Next Destinies Promos
  1889, // Dark Explorers
  1890, // Dark Explorers Promos
  1891, // Dragons Exalted Promos
  1892, // Boundaries Crossed Promos
  1893, // Plasma Storm Promos
  1894, // Plasma Freeze Promos
  1895, // Plasma Blast Promos
  1896, // Legendary Treasures
  1897, // Legendary Treasures Promos
  1898, // XY Promos
  1901, // Phantom Forces Promos
  1902, // Primal Clash Promos
  1903, // Roaring Skies Promos
  1906, // BREAKpoint Promos
  1907, // Radiant Collection Generation
  1908, // Generations Promos
  1910, // Steam Siege Promos
  1911, // Evolutions Promos
  1913, // Burning Shadows
  1914, // Burning Shadows Promos
  1915, // Shining Legends
  1916, // Shining Legends Promos
  1918, // Ultra Prism Promos
  1920, // Celestial Storm Promos
  1921, // Dragon Majesty Promos
  1922, // Lost Thunder Promos
  1926, // McDonald's Collection 2013 French
  1927, // McDonald's Collection 2018 French
  1928, // Poké Card Creator Pack
  1929, // Nintendo Black Star Promos
  1930, // Best of Game
  1931, // Radiant Collection Legendary Treasure
  1932, // Box Topper
  1933, // XY Trainer Kit: Latias
  1934, // XY Trainer Kit: Latios
  1935, // EX Trainer Kit 2 (Plusle)
  1936, // EX Trainer Kit 2 (Minun)
  1937, // DP Trainer Kit (Manaphy)
  1938, // DP Trainer Kit (Lucario)
  1939, // HS Trainer Kit (Gyarados)
  1940, // HS Trainer Kit (Raichu)
  1941, // BW Trainer Kit Excadrill
  1942, // BW Trainer Kit Zoroark
  1943, // XY Trainer Kit: Sylveon
  1944, // XY Trainer Kit: Noivern
  1945, // XY Trainer Kit: Bisharp
  1946, // XY Trainer Kit: Wigglytuff
  1947, // XY Trainer Kit: Pikachu Libre & Suicune (Pikachu Libre)
  1948, // XY Trainer Kit: Pikachu Libre & Suicune (Suicune)
  1949, // Sun & Moon Trainer Kit: Lycanroc & Alolan Raichu (Lycanroc)
  1950, // Sun & Moon Trainer Kit: Lycanroc & Alolan Raichu (Alolan Raichu)
  1955, // Rebel Clash Promos
  1969, // Base Set Shadowless
  1970, // Expansion Pack & Starter Pack
  1971, // Expansion Pack & Starter Pack No Rarity
  1972, // Pokémon Jungle
  1973, // Mystery of the Fossils
  1974, // Rocket Gang
  1975, // Gym Booster 1 Leaders' Stadium
  1976, // Gym Booster 2: Challenge from the Darkness
  1977, // Gold, Silver, to a New World...
  1978, // Gold, Silver, to a New World… Premium File
  1979, // Crossing the Ruins...
  1980, // Crossing the Ruins… Premium File 2
  1981, // Awakening Legends
  1982, // Awakening Legends Premium File 3
  1983, // Darkness, and to Light...
  1984, // Pokémon VS
  1985, // Pokémon Web
  1986, // Base Expansion Pack
  1987, // The Town on No Map
  1988, // Wind from the Sea
  1989, // Split Earth
  1990, // Mysterious Mountains
  1991, // ADV Expansion Pack
  1992, // Miracle of the Desert
  1993, // Rulers of the Heavens
  1994, // Magma VS Aqua: Two Ambitions
  1995, // Undone Seal
  1996, // Flight of Legends
  1997, // Rocket Gang Strikes Back
  1998, // Clash of the Blue Sky
  1999, // Golden Sky, Silvery Ocean
  2000, // Holon Research Tower
  2001, // Mirage Forest
  2002, // Holon Phantoms
  2003, // Miracle Crystal
  2004, // Offense and Defense of the Furthest Ends
  2005, // World Champions Pack
  2007, // Space-Time Creation
  2008, // Secret of the Lakes
  2009, // Shining Darkness
  2010, // Moonlit Pursuit
  2011, // Dawn Dash
  2012, // Cry from the Mysterious
  2013, // Temple of Anger
  2014, // Intense Fight in the Destroyed Sky
  2015, // Galactic's Conquest
  2016, // Bonds to the End of Time
  2017, // Beat of the Frontier
  2018, // Advent of Arceus
  2019, // HeartGold Collection
  2020, // SoulSilver Collection
  2021, // Reviving Legends
  2022, // Clash at the Summit
  2023, // Black Collection
  2024, // White Collection
  2025, // Red Collection
  2026, // Psycho Drive
  2027, // Hail Blizzard
  2028, // Dark Rush
  2029, // Dragon Blast
  2030, // Dragon Blade
  2031, // Freeze Bolt
  2032, // Cold Flare
  2033, // Plasma Gale
  2034, // Spiral Force
  2035, // Thunder Knuckle
  2036, // Megalo Cannon
  2037, // EX Battle Boost
  2038, // Collection X
  2039, // Collection Y
  2040, // Wild Blaze
  2041, // Rising Fist
  2042, // Phantom Gate
  2043, // Gaia Volcano
  2044, // Tidal Storm
  2045, // Emerald Break
  2046, // Bandit Ring
  2047, // Blue Shock
  2048, // Red Flash
  2049, // Rage of the Broken Heavens
  2050, // Starter Pack
  2051, // Awakening Psychic King
  2052, // Fever-Burst Fighter
  2053, // Cruel Traitor
  2054, // Expansion Pack 20th Anniversary
  2055, // Collection Sun
  2056, // Collection Moon
  2057, // Islands Await You
  2058, // Alolan Moonlight
  2059, // To Have Seen the Battle Rainbow
  2060, // Darkness that Consumes Light
  2061, // Strength Expansion Pack Shining Legends
  2062, // Awakened Heroes
  2063, // Ultradimensional Beasts
  2064, // Ultra Sun
  2065, // Ultra Moon
  2066, // Sky-Splitting Charisma
  2067, // Strength Expansion Pack Dragon Storm
  2068, // Super-Burst Impact
  2069, // Tag Bolt
  2070, // Double Blaze
  2071, // Miracle Twin
  2072, // High Class Pack GX Ultra Shiny
  2073, // Alter Genesis
  2094, // Shaymin LV. X COLLECTION PACK
  2095, // Lost Link
  2101, // BW Promos
  2108, // Vivid Voltage Merchendise
  2112, // Futsal Promos
  2124, // VMAX Starter Deck: Blastoise VMAX
  2125, // VMAX Starter Deck: Venusaur VMAX
  2128, // VMAX Special Set
  2139, // McDonald's Collection 25th Anniversary
  2150, // Silver Lance & Jet Black Spirit Jumbo Pack Set
  2174, // Mythical & Legendary Dream Shine Collection
  2185, // Inteleon VMAX High-Class Deck
  2186, // Gengar VMAX High-Class Deck
  2187, // Eevee Heroes VMAX Special Set
  2613, // Pikachu World Collection
  2627, // Special Deck Set Zacian Zamazenta vs Eternatus
  2781, // Dragon Storm
  2782, // Legendary Shine Collection
  2783, // Forbidden Light JP
  2917, // VMAX Climax
  2918, // POKÉMON TRAINERS Off Shot!
  2919, // 25th Anniversary Golden Box
  2937, // Unnumbered Promos
  2938, // PLAY Promos
  3057, // Pokémon GO Enhanced Expansion Pack
  3138, // Trick or Trade
  3141, // McDonald's Match Battle 2022
  3155, // Sword & Shield: Ultra-Premium Collection | Charizard
  3158, // EX Battle Stadium
  3195, // VSTAR Special Set
  3196, // Special Battle Set Charizard VSTAR vs Rayquaza VMAX
  3197, // VSTAR & VMAX High Class Deck Zeraora
  3198, // VSTAR & VMAX High Class Deck Deoxys
  3201, // Sword & Shield Starter Set Lucario VSTAR
  3202, // Sword & Shield Starter Set Darkrai VSTAR
  3204, // Premium Trainer Box VSTAR
  3205, // V-UNION Special Card Sets
  3206, // Start Deck 100
  3240, // Scarlet & Violet JP: Premium Trainer Box ex
  3241, // ex Starter Set: Fuecoco & Ampharos ex
  3242, // ex Starter Set: Sprigatito & Lucario ex
  3243, // ex Starter Set: Quaxly & Mimikyu ex
  3269, // Single Strike & Rapid Strike Premium Trainer Boxes
  3272, // Play! Pokémon Prize Pack Series
  3273, // Start Deck 100 CoroCoro Comic Version
  3304, // V-UNION Special Collection
  3338, // DPt Promos
  3339, // Movie Commemoration Random
  3340, // P Promos
  3341, // McDonald's Pokémon-e Minimum Pack
  3342, // Night Unison
  3347, // Mewtwo LV.X Collection Pack
  3348, // Regigigas LV.X Collection
  3349, // Heatran vs Regigigas Deck Kit
  3350, // Infernape SP Half Deck
  3351, // Gallade SP Half Deck
  3352, // PCG Promos
  3388, // ex Start Decks
  3389, // World Championship Decks
  3390, // Scarlet & Violet Products
  3391, // Scarlet & Violet ex Special Set
  3404, // Expansion Sheet
  3405, // Intro Pack Bulbasaur
  3406, // Intro Pack Squirtle
  3407, // Southern Islands JP
  3408, // Intro Pack Neo Totodile
  3409, // T Promos
  3410, // Theater Limited VS Pack
  3411, // ADV Promos
  3412, // Movie Commemoration VS Pack
  3413, // Movie Commemoration VS Pack: Sky-Splitting Deoxys
  3414, // PokéPark Forest
  3415, // PokéPark Blue
  3416, // Movie Commemoration VS Pack: Aura's Lucario
  3417, // L-P Promo
  3418, // Gift Box Mew • Lucario
  3419, // Movie Commemoration VS Pack: Sea's Manaphy
  3420, // DP Promos
  3421, // Bastiodon the Defender
  3422, // Rampardos the Attacker
  3423, // PPP Promos
  3424, // Dialga LV.X Constructed Standard Deck
  3425, // Palkia LV.X Constructed Standard Deck
  3426, // 10th Movie Commemoration Set
  3427, // Magmortar vs Electivire Deck Kit
  3428, // Entry Pack '08
  3429, // Kuchiba City Gym
  3430, // Giratina Half Deck
  3431, // 11th Movie Commemoration Set
  3432, // Giratina DPt
  3437, // Fairy Rise
  3438, // Great Detective Pikachu
  3439, // Yamabuki City Gym
  3440, // Guren Town Gym
  3442, // Intro Pack Neo Chikorita
  3444, // Tag Team GX: Tag All Stars
  3445, // Champion Road
  3446, // VMAX Rising
  3447, // Nivi City Gym
  3448, // Dark Order
  3449, // Dream League
  3450, // GG End
  3451, // Sky Legend
  3452, // Theme Deck & Blisters Exclusives
  3456, // McDonald's Match Battle 2023
  3467, // Trick or Trade 2023
  3520, // Terastal Starter Set Skeledirge ex
  3522, // Terastal Starter Set Mewtwo ex
  3523, // World Championships 2023 Yokohama Deck -Pikachu-
  3524, // YU NAGABA x Pokemon Card Game
  3535, // Dialga Half Deck
  3536, // Giratina DPt Half Deck
  3537, // Palkia DPt Half Deck
  3538, // Dialga DPt Half Deck
  3547, // Venusaur & Charizard & Blastoise Special Deck Set ex
  3548, // Pokémon Card Game Classic: Blastoise & Suicune ex Deck
  3549, // My First Battle
  3550, // Pokémon Card Game Classic: Venusaur & Lugia ex Deck
  3551, // Pokémon Card Game Classic: Charizard & Ho-Oh ex Deck
  3552, // Pokémon TCG Classic: Blastoise & Suicune ex Deck
  3553, // Pokémon TCG Classic: Charizard & Ho-Oh ex Deck
  3554, // Pokémon TCG Classic: Venusaur & Lugia ex Deck
  3578, // PokéKyun Collection
  3579, // Premium Champion Pack
  3583, // First Partner Pack
  3588, // Starter Deck & Build Set Ancient Koraidon ex
  3589, // Starter Deck & Build Set Future Miraidon ex
  3593, // Tag Team GX Starter Sets
  3594, // Shiny Collection
  3608, // Explosive Flame Walker
  3609, // Full Metal Wall
  3616, // Hanada City Gym
  3652, // Tamamushi City Gym
  3653, // Professor Program
  3655, // Charizard SP Half Deck
  3656, // Rayquaza Constructed Starter Deck
  3665, // The Best of XY
  3679, // Treecko Constructed Starter Deck
  3680, // Torchic Constructed Starter Deck
  3681, // Mudkip Constructed Starter Deck
  3682, // Flygon Constructed Starter Deck
  3683, // Salamence Constructed Starter Deck
  3684, // Latias ex Half Deck
  3685, // Latios ex Half Deck
  3686, // Metagross Constructed Starter Deck
  3688, // Deoxys Constructed Starter Deck
  3689, // Black Deck Kit
  3690, // Silver Deck Kit
  3691, // Gift Box Emerald • Deoxys Half Deck
  3692, // Gift Box Emerald • Rayquaza Half Deck
  3694, // Meganium Constructed Starter Deck
  3695, // Typhlosion Constructed Starter Deck
  3696, // Feraligatr Constructed Starter Deck
  3697, // Mirage's Mew Constructed Starter Deck
  3698, // Master Kit
  3699, // Holon Research Tower Decks
  3700, // Earth's Groudon ex Constructed Starter Deck
  3701, // Ocean's Kyogre ex Constructed Starter Deck
  3702, // Entry Pack
  3703, // Gift Box DPt
  3704, // Infernape vs Gallade SP Deck Kit
  3705, // Garchomp vs Charizard SP Deck Kit
  3708, // Beginning Set
  3709, // Battle Strength Decks
  3710, // Battle Theme Deck: Victini
  3711, // Battle Gift Set: Thundurus vs Tornadus
  3712, // Hydreigon Half Deck
  3713, // Garchomp Half Deck
  3714, // Keldeo Battle Strength Deck
  3716, // Team Plasma's Powered Half Deck
  3717, // Team Plasma Battle Gift Set
  3718, // Everyone's Exciting Battle
  3719, // Mewtwo vs Genesect Deck Kit
  3720, // Xerneas Half Deck
  3721, // Yveltal Half Deck
  3724, // Excadrill Half Deck
  3725, // Zoroark Half Deck
  3730, // Master Kit: Bulbasaur Quarter Deck
  3731, // Master Kit: Torchic Quarter Deck
  3732, // Holon Research Tower: Fire Quarter Deck
  3733, // Holon Research Tower: Water Quarter Deck
  3734, // Holon Research Tower: Lightning Quarter Deck
  3746, // GX Starter De
  3748, // McDonald's Collection 2019 French
  3752, // GX Battle Boost
  3754, // Pokémon Card 151 - Master Ball Reverse Holo
  3758, // Battle Master Deck Tera Charizard ex
  3759, // Battle Master Deck Chien-Pao ex
  3778, // Ruler of the Black Flame Deck Build Box
  3786, // Trick or Trade 2024
  3794, // Eevee GX Starter Sets
  3796, // Thunderclap Spark
  3802, // Zygarde EX Perfect Battle Deck
  3803, // Tag Team GX Deck Build Box
  3811, // Rockruff Full Power Deck
  3812, // Fighting Quick Construction Pack
  3813, // Grass Quick Construction Pack
  3814, // Fire Quick Construction Pack
  3815, // Water Quick Construction Pack
  3816, // Lightning Quick Construction Pack
  3817, // Psychic Quick Construction Pack
  3819, // Magma Deck Kit
  3822, // VMAX Starter Deck: Charizard VMAX
  3824, // Stellar Miracle Deck Build Box
  3825, // Stellar Tera Type Starter Set Ceruledge ex
  3826, // Stellar Tera Type Starter Set Sylveon ex
  3855, // Battle Academy 2024
  3864, // Venusaur, Charizard & Blastoise Random Constructed Starter Decks
  3896, // Battle Academy 2022
  3903, // Imprison! Gardevoir ex Constructed Standard Deck
  3904, // Strength Expansion Pack Sun & Moon
  3927, // Generations Start Decks
  3935, // For Position Only
  3936, // Simplified Chinese Products
  3939, // Magma Gang VS Aqua Gang: Double Crisis
  3940, // Scarlet & Violet Battle Academy
  3942, // Southeast Asia Gym Promos
  3946, // Pikachu DPt Half Deck
  3947, // Piplup DPt Half Deck
  3948, // Turtwig DPt Half Deck
  3949, // Chimchar DPt Half Deck
  3950, // Arceus LV.X Deck: Lightning & Psychic
  3951, // Arceus LV.X Deck: Grass & Fire
  3952, // Melee! Pokémon Scramble
  3953, // Blastoise Battle Starter Deck
  3954, // Raichu Battle Starter Deck
  3955, // Magmortar Battle Starter Deck
  3956, // Metagross Expert Deck
  3957, // Leafeon Expert Deck
  3958, // Torterra Battle Starter Deck
  3959, // White Kyurem EX Battle Strength Deck
  3960, // Black Kyurem EX Battle Strength Deck
  3961, // Dragon Selection
  3962, // Hyper Metal Chain Deck
  3963, // MCharizard EX Mega Battle Deck
  3964, // Super Legend Set: Xerneas EX & Yveltal EX
  3965, // Master Deck Build Box EX
  3966, // National Pokédex Beginning Set
  3967, // VMAX Starter Decks 2: Charizard VMAX
  3974, // Grass Starter Set V
  3975, // Fire Starter Set V
  3976, // Ultra Force
  3983, // Traditional Chinese Products
  3984, // Shockwave! Tyranitar ex Constructed Standard Deck
  3985, // Terastal Festival ex - Master Ball Reverse Holo
  3986, // McDonald's Dragon Discovery
  3989, // Battle Partners Deck Build Box
  3997, // Aqua Deck Kit
  3998, // Water Starter Set V
  3999, // Facing a New Trial
  4000, // Ash vs Team Rocket Deck Kit
  4004, // XY Beginning Set
  4005, // Reshiram EX Battle Strength Deck
  4006, // Battle Academy 2020
  4007, // CS3a: Primordial Martial Arts - Overgrowth
  4009, // Gem Pack Vol.1
  4010, // Collect 151
  4011, // CSM2.5: Striking Competition
  4012, // CSM2a: Shining Synergy - Shower
  4013, // CSM2b: Shining Synergy - Supreme
  4014, // CSM2c: Shining Synergy - Summon
  4015, // CSM1a: Storming Emergence - Radiant
  4016, // CSM1b: Storming Emergence - Verdant
  4017, // CSM1c: Storming Emergence - Abundant
  4018, // CSM: Brave Stars Promo Pack
  4019, // CSG: Nine Colors Gathering Promo Pack
  4020, // CSD: Primordial Arts Promo Pack
  4021, // CS6.1: Shadow of the Blue Sea Promos
  4022, // CSF: Return of the Dragon
  4023, // CS4.1: Brilliant Energy Promo Pack
  4024, // CS5.1: Shadow of Glory Promo Pack
  4025, // CS6.5: Victory Star Guide
  4026, // CS1.5: Dynamax Tactics
  4027, // CS2.5: Brilliant Counterattack
  4028, // CS3.5: Scorching Skies
  4029, // CS4.5: Final Flame Dance
  4030, // CS5.5: Shadow of Glory
  4031, // Prismatic Evolutions - Master Ball Reverse Holo
  4032, // Collect 151 - Master ball Reverse Holo
  4035, // CSV1: Eternal Birth
  4041, // CS4a: Nine Colors Gathering - Friends
  4042, // CS4b: Nine Colors Gathering - Origin
  4043, // CS1a: Dynamax Clash - Thunder
  4044, // CS1b: Dynamax Clash - Flame
  4045, // CS2a: Vivid Portrayals - Obsidian
  4046, // CS2b: Vivid Portrayals - Indigo
  4047, // CS3b: Primordial Martial Arts - Torrent
  4048, // CS5a: Brave Enchanting Stars - Brave
  4049, // CS5b: Brave Enchanting Stars - Charm
  4050, // CS6a: Azure Shadow - Roar
  4051, // CS6b: Azure Shadow - Pursuit
  4052, // CSM1.5: Battle Elite
  4053, // Prismatic Evolutions - Poké Ball Reverse Holo
  4063, // Starter Set ex Steven's Beldum & Metagross ex
  4064, // Starter Set ex Marnie's Morpeko & Grimmsnarl ex
  4067, // V Starter Decks
  4068, // MRayquaza EX Mega Battle Deck
  4069, // Blastoise + Kyurem EX Combo Deck
  4070, // M Audino EX Mega Battle Deck
  4072, // Emboar EX vs Togekiss EX Deck Kit
  4073, // Zekrom EX Battle Strength Deck
  4074, // Sun & Moon Family Pokémon Card Game
  4075, // Lightning Starter Set V
  4076, // Fighting Starter Set V
  4089, // Steelix Constructed Standard Deck
  4094, // Tag Team GX Premium Trainer Box
  4095, // Sun & Moon Starter Set
  4110, // CSH: Eevee GX Gift Box
  4112, // Zacian + Zamazenta BOX
  4113, // Trainer Battle Decks
  4114, // Golduck BREAK + Palkia EX Combo Deck
  4115, // Tyranitar Constructed Standard Deck
  4151, // Pokémon-e Starter Deck
  4158, // Quick Starter Gift Set 1998
  4160, // CSV2: Miracle Journey
  4161, // CSV2: Miracle Journey - Master ball Reverse Holo
  4162, // Gem Pack Vol.2
  4163, // CSV3: Fearless Terastal
  4187, // CSVH1: Happy Combination Pikachu & Clefairy Transformation Pack
  4200, // M Master Deck Build Box Power Style
  4201, // M Master Deck Build Box Speed Style
  4210, // Solgaleo GX & Lunala GX Legendary Starter Set
  4222, // White Flare | sv11W - Master Ball Reverse Holo
  4223, // Black Bolt | sv11B - Master Ball Reverse Holo
  4237, // Mega Brave
  4238, // Mega Symphonia
  4263, // Black Bolt - Master Ball Reverse Holo
  4264, // White Flare - Master Ball Reverse Holo
  4265, // White Flare - Poké Ball Reverse Holo
  4266, // Black Bolt - Poké Ball Reverse Holo
  4267, // CSV4: Bonus Round
  4274, // CSVL1: Adventure Special Pack
  4277, // Premium Trainer Box MEGA
  4278, // Mega Evolution Products
  4279, // CSV5: Dark Crystal Blaze
  4280, // MEP Black Star Promos
  4290, // M-P Promos
  4291, // Starter Set MEGA Mega Diancie ex
  4292, // Starter Set MEGA Mega Gengar ex
  4312, // Gem Pack Vol.3
  4322, // Scarlet & Violet Simplified Chinese Promos
  4336, // Mega Evolution Energies
  4337, // Pokémon Center
  4339, // Holiday Calendar
  4366, // CSV6: True Mystery
  4367, // CSVL2: Travel Special Pack
  4368, // MEGA Start Deck 100 Battle Collection
  4373, // Pokémon Misprints
  4374, // Prerelease Promos
  4382, // Retail Exclusive Promos
  4403, // MEGA Dream ex - Ball & Rocket Reverse Holo
  4404, // Pokémon Card 151 - Poké Ball Reverse Holo
  4405, // Terastal Festival ex - Poké Ball Reverse Holo
  4406, // Black Bolt | sv11B - Poké Ball Reverse Holo
  4407, // White Flare | sv11W - Poké Ball Reverse Holo
  4408, // MEGA Dream ex - Energy Reverse Holo
  4414, // CSV6: True Mystery - Reverse Holo
  4427, // CoroCoro Promo
  4432, // MEGA Start Deck 100 Battle Collection Corociao Version
  4460, // Ascended Heroes - Energy Reverse Holo
  4461, // Ascended Heroes - Ball & Rocket Reverse Holo
  4469, // Gem Pack Vol.4
  4471, // CSM2d: Shining Synergy GX Starter Deck
  4472, // CS5D: Gallant Galaxy V Starter Deck
  4473, // CSMPaC: Battle Party Combo | Grass Deck
  4474, // CSMPbC: Battle Party Combo | Fire Deck
  4475, // CSMPeC: Battle Party Combo | Water Deck
  4476, // CSMPdC: Battle Party Combo | Lightning Deck
  4477, // CSMPeC: Battle Party Combo | Psychic Deck
  4478, // CSMPfC: Battle Party Combo | Fighting Deck
  4479, // CSMPgC: Battle Party Combo | Darkness Deck
  4480, // CSMPhC: Battle Party Combo | Metal Deck
  4481, // CSMPiC: Battle Party Set Reward Pack
  4482, // CSMPjC: Grass Modification Pack
  4483, // CSMPkC: Fire Modification Pack
  4484, // CSMPlC: Water Modification Pack
  4485, // CSMPmC: Lightning Modificatio
  4486, // CSMPnC: Psychic Modification Pack
  4487, // CSMPoC: Fighting Modification Pack
  4488, // CSMPpC: Darkness Modification Pack
  4489, // CSMPqC: Metal Modification Pack
  4492, // Scarlet & Violet Indonesian Promos
  4493, // CSMyC: Eevee-GX Box Sets
  4494, // CSML: Lillie's Support Box
  4498, // CSV8: Brilliant Fantasy
  4500, // World Championship Decks 2004
  4501, // World Championship Decks 2005
  4502, // World Championship Decks 2006
  4503, // World Championship Decks 2007
  4504, // World Championship Decks 2008
  4505, // World Championship Decks 2009
  4506, // World Championship Decks 2010
  4507, // World Championship Decks 2011
  4508, // World Championship Decks 2012
  4509, // World Championship Decks 2013
  4510, // World Championship Decks 2014
  4511, // World Championship Decks 2015
  4512, // World Championship Decks 2016
  4513, // World Championship Decks 2017
  4514, // World Championship Decks 2018
  4515, // World Championship Decks 2019
  4516, // World Championship Decks 2022
  4517, // World Championship Decks 2023
  4518, // World Championship Decks 2024
  4519, // World Championship Decks 2025
  4531, // CSM1d: Storming Emergence GX Starter Deck
  4544, // Beginning Set | Pikachu Version
  4545, // Beginning Set Plus
  4558, // CSVH2: Happy Combination Lucario & Greninja & Zamazenta & Mabosstiff
  4559, // CSUC: Display Set Gift Box Gengar
  4560, // CSGC: Display Set Gift Box Eevee
  4565, // CSVE1: Battle Party Dream Together
  4566, // 30th Anniversary Celebration: First Partner Illustration Collection
  4587, // CSBC: Primordial Arts Deck Building Gift Box | Overgrow
  4590, // CSMA: Arceus & Dialga & Palkia-GX Advanced Deck Building Gift Box
  4591, // CSMJ: Shining Pokémon Poké Ball Gift Box
  4592, // Gem Pack Vol.5
  4595, // CSVH4a: Happy Set Modification Pack
  4596, // CSVH4eC: Happy Pack
  4597, // CSVH4pC: Reward Pack
  4607, // CSDC: Pikachu Legendary Celebration
  4610, // Collection Sheet Journey Partners
  4628, // Scarlet & Violet Korean Promos
  4638, // CSV9: Stellar Crystal
  4639, // Pitch Black
  4643, // CSV9: Poké Ball Reverse
  4644, // CSV9: Master Ball Reverse
  4645, // CSVNC: Land of Kitakami Special Pack
  4655, // CSV9.5: Terastal Gathering
  4656, // VMAX Starter Deck: Grimmsnarl VMAX
  4657, // Sword & Shield Premium Trainer Box
  4669, // CSI: Sword & Shield Trainer Collection Gift Box
];


// ════════════════════════════════════════════════════════════════════
// LOGHI E DATE DEI SET (dal repository GitHub di PokemonTCG)
// ════════════════════════════════════════════════════════════════════
// CardTrader non fornisce il logo dei set né la data di uscita.
// Per i set internazionali li recuperiamo dal file JSON pubblico del
// progetto PokemonTCG su GitHub, costruendo una mappa:
//     nome set (minuscolo) → { logo, releaseDate }
// ════════════════════════════════════════════════════════════════════

// Cache in memoria: evita di riscaricare il JSON da GitHub a ogni set.
// Vive solo per la durata dell'esecuzione corrente di Apps Script.
var _cacheMappaSetGithub = null;

/**
 * Scarica (una sola volta per esecuzione) la mappa dei set internazionali
 * dal repository GitHub di PokemonTCG.
 * In caso di errore restituisce una mappa vuota: la sync prosegue
 * semplicemente senza loghi/date per quei set.
 */
function getGithubSetsMap() {
  if (_cacheMappaSetGithub) return _cacheMappaSetGithub;

  try {
    var risposta = UrlFetchApp.fetch(
      'https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/sets/en.json',
      { muteHttpExceptions: true }
    );
    if (risposta.getResponseCode() !== 200) return {};

    var mappa = {};
    JSON.parse(risposta.getContentText()).forEach(function(set) {
      mappa[set.name.toLowerCase()] = {
        logo:        (set.images && set.images.logo) ? set.images.logo : '',
        releaseDate: set.releaseDate || ''
      };
    });

    _cacheMappaSetGithub = mappa;
    return mappa;
  } catch (errore) {
    return {};
  }
}


// ════════════════════════════════════════════════════════════════════
// HELPER HTTP PER CARDTRADER
// ════════════════════════════════════════════════════════════════════

/**
 * Costruisce gli header di autenticazione per le chiamate a CardTrader.
 * La key va passata esplicitamente: durante la sync (che gira da trigger,
 * senza utente loggato) viene letta una volta sola dal master e passata qui.
 */
function headerAutenticazioneCardTrader(apiKey) {
  return { 'Authorization': 'Bearer ' + (apiKey || '') };
}

/**
 * Esegue una GET sull'API CardTrader e restituisce il JSON già parsato.
 * In caso di problemi restituisce un oggetto { _error: '...' } che il
 * chiamante può controllare.
 *
 * @param {string} url    - URL completo dell'endpoint CardTrader
 * @param {string} apiKey - API key da usare nell'header Authorization
 */
function chiamaCardTrader(url, apiKey) {
  var risposta = UrlFetchApp.fetch(url, {
    headers: headerAutenticazioneCardTrader(apiKey),
    muteHttpExceptions: true
  });

  if (risposta.getResponseCode() !== 200) {
    return { _error: 'HTTP ' + risposta.getResponseCode() };
  }

  try {
    var dati = JSON.parse(risposta.getContentText());
    // Alcuni endpoint CardTrader incapsulano i dati in { array: [...] }.
    return (dati && dati.array) ? dati.array : dati;
  } catch (errore) {
    return { _error: 'JSON non valido' };
  }
}


// ════════════════════════════════════════════════════════════════════
// SINCRONIZZAZIONE DEL CATALOGO (multi-hop, gira da trigger)
// ════════════════════════════════════════════════════════════════════
// Il catalogo è UNICO e condiviso: CACHE_CARDS e SET_CACHE vivono nel
// master (vedi getSheet/getMasterSheetByName in Code.gs). La sync NON è
// più lanciabile dall'interfaccia: viene avviata da un trigger temporizzato
// che tu agganci manualmente alla funzione syncCatalog().
//
// Le funzioni Apps Script hanno un timeout di 6 minuti, ma scaricare
// centinaia di set richiede di più. Stesso schema multi-hop dei prezzi
// (vedi Prices.gs): si lavora per ~5 minuti, si salva un cursore, e ci si
// riprogramma da soli con un trigger one-shot after(). Lo stato vive nel
// foglio BATCH_STATE del master con chiavi prefissate 'catalog_' (così non
// collide con lo stato del batch prezzi che sta nello stesso foglio):
//
//   catalog_running    'true' | 'false'  — semaforo dell'intero giro
//   catalog_cursor      id set | 'DONE'  — ultimo set elaborato
//   catalog_last_sync   timestamp        — fine ultima sync completata
//   catalog_run_started timestamp        — inizio giro corrente (diagnostica)
//
// La sync è INCREMENTALE: i set già presenti in SET_CACHE vengono saltati,
// quindi ad ogni giro scarica solo i set nuovi.
//
// La API key CardTrader usata dalla sync è la PRIMA dell'elenco master
// (di norma il proprietario) — vedi getCardTraderApiKey() in Code.gs.
// ════════════════════════════════════════════════════════════════════

// ---- Costanti del batch di sync catalogo --------------------------------
var SYNC_NOME_FOGLIO_STATO = 'BATCH_STATE';            // stesso foglio dei prezzi
var SYNC_LIMITE_MS         = 5 * 60 * 1000;            // 5 min di lavoro per hop
var SYNC_RITARDO_HOP_MS    = 60 * 1000;                // riprogramma dopo 1 min
var SYNC_FUNZIONE_WORKER   = '_syncWorkerCatalog';     // nome funzione one-shot


// ════════════════════════════════════════════════════════════════════
// STATO DELLA SYNC — lettura/scrittura su BATCH_STATE nel master
// ════════════════════════════════════════════════════════════════════

/** Apre (creandolo se manca) il foglio BATCH_STATE nel master. */
function _getSyncStateSheet() {
  var master = SpreadsheetApp.openById(ID_FOGLIO_MASTER_UTENTI);
  var foglio = master.getSheetByName(SYNC_NOME_FOGLIO_STATO);
  if (!foglio) foglio = master.insertSheet(SYNC_NOME_FOGLIO_STATO);
  return foglio;
}

/** Legge tutte le chiavi di stato in un oggetto. */
function _leggiStatoSync() {
  var foglio = _getSyncStateSheet();
  var righe  = foglio.getDataRange().getValues();
  var stato  = {};
  for (var i = 0; i < righe.length; i++) {
    if (righe[i][0]) stato[String(righe[i][0])] = righe[i][1];
  }
  return stato;
}

/** Scrive (o aggiorna) una singola chiave di stato. */
function _scriviStatoSync(chiave, valore) {
  var foglio = _getSyncStateSheet();
  var righe  = foglio.getDataRange().getValues();
  for (var i = 0; i < righe.length; i++) {
    if (String(righe[i][0]) === chiave) {
      foglio.getRange(i + 1, 2).setValue(valore);
      return;
    }
  }
  foglio.appendRow([chiave, valore]);
}

/** Scrive più chiavi di stato in un colpo solo. */
function _scriviStatoSyncMulti(oggetto) {
  for (var chiave in oggetto) {
    if (oggetto.hasOwnProperty(chiave)) _scriviStatoSync(chiave, oggetto[chiave]);
  }
}


// ════════════════════════════════════════════════════════════════════
// PULIZIA / RIPROGRAMMAZIONE DEI TRIGGER ONE-SHOT
// ════════════════════════════════════════════════════════════════════

/**
 * Cancella i trigger one-shot che puntano al worker della sync. I trigger
 * after() non si auto-rimuovono: senza pulizia si accumulano e saturano la
 * quota. Va chiamata all'inizio di ogni hop e prima di crearne uno nuovo.
 */
function _pulisciTriggerSync() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === SYNC_FUNZIONE_WORKER) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

/** Crea il trigger one-shot che richiamerà il worker dopo SYNC_RITARDO_HOP_MS. */
function _programmaProssimoHopSync() {
  _pulisciTriggerSync(); // evita duplicati
  ScriptApp.newTrigger(SYNC_FUNZIONE_WORKER)
    .timeBased()
    .after(SYNC_RITARDO_HOP_MS)
    .create();
  Logger.log('[SYNC] Prossimo hop programmato tra ' + (SYNC_RITARDO_HOP_MS / 1000) + 's');
}


// ════════════════════════════════════════════════════════════════════
// KICKOFF — entry point del trigger temporizzato
// ════════════════════════════════════════════════════════════════════

/**
 * Avvia un nuovo giro completo di sync. Questa è la funzione da agganciare
 * al trigger temporizzato (es. settimanale). Non prende argomenti e non
 * richiede sessione utente: gira interamente sul master.
 *
 * Se un giro precedente è ancora in corso (catalog_running === 'true'),
 * salta con uno skip pulito invece di sovrapporsi.
 */
function syncCatalog() {
  Logger.log('[SYNC] Kickoff syncCatalog');

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30 * 1000); // micro-lock: solo per leggere/scrivere lo stato
  } catch (e) {
    Logger.log('[SYNC] Lock non ottenuto al kickoff, skip.');
    return;
  }

  try {
    var stato = _leggiStatoSync();
    if (String(stato.catalog_running) === 'true') {
      Logger.log('[SYNC] Giro precedente ancora in corso → skip pulito.');
      return;
    }

    // Inizializza il giro: azzera il cursore e alza il semaforo.
    _scriviStatoSyncMulti({
      catalog_running:     'true',
      catalog_cursor:      '',
      catalog_run_started: formatDate(new Date())
    });
  } finally {
    lock.releaseLock();
  }

  // Avvia subito il primo hop (il kickoff lavora già lui).
  _syncWorkerCatalog();
}


// ════════════════════════════════════════════════════════════════════
// WORKER — esegue un singolo hop e si riprogramma se non ha finito
// ════════════════════════════════════════════════════════════════════

/**
 * Worker della sync multi-hop. Chiamato sia dal kickoff (primo hop) sia dai
 * trigger one-shot (hop successivi). Riprende dal cursore salvato in
 * BATCH_STATE, lavora al massimo SYNC_LIMITE_MS, poi:
 *   • se restano set da scaricare → salva il cursore e si riprogramma;
 *   • se ha finito → segna 'DONE', salva last_sync, libera il semaforo.
 */
function _syncWorkerCatalog() {
  var istanteInizio = Date.now();
  Logger.log('[SYNC] === Hop worker start ===');

  // Rimuove il trigger one-shot che ha fatto partire QUESTO hop (se c'è).
  _pulisciTriggerSync();

  // ---- Controllo semaforo ----
  var stato = _leggiStatoSync();
  if (String(stato.catalog_running) !== 'true') {
    Logger.log('[SYNC] catalog_running != true → niente da fare.');
    return;
  }

  var dataOraAdesso = formatDate(new Date());

  try {
    // ---- API key dal master (prima riga = di norma il proprietario) ----
    var apiKey = getCardTraderApiKey();
    if (!apiKey) {
      Logger.log('[SYNC] Nessuna API key CardTrader nel master → stop giro.');
      _scriviStatoSync('catalog_running', 'false');
      return;
    }

    // ---- 1. Scarica la lista di TUTTE le espansioni da CardTrader ----
    var tutteLeEspansioni = chiamaCardTrader(URL_BASE_API_CARDTRADER + '/expansions', apiKey);
    if (tutteLeEspansioni._error) {
      Logger.log('[SYNC] Errore espansioni: ' + tutteLeEspansioni._error + ' → riprovo al prossimo hop.');
      _programmaProssimoHopSync(); // problema possibilmente transitorio
      return;
    }

    // ---- 2. Filtra: solo Pokémon e non in blacklist ----
    var espansioniDaScaricare = tutteLeEspansioni.filter(function(espansione) {
      return espansione.game_id === ID_GIOCO_POKEMON_SU_CARDTRADER &&
             ID_ESPANSIONI_ESCLUSE.indexOf(espansione.id) === -1;
    });
    Logger.log('[SYNC] Set target dopo filtro: ' + espansioniDaScaricare.length);

    var foglioSet   = getSheet('SET_CACHE');   // → master
    var foglioCarte = getSheet('CACHE_CARDS'); // → master

    // ---- 3. Se i fogli sono vuoti, scrivi le intestazioni ----
    if (foglioSet.getLastRow() === 0) {
      foglioSet.appendRow(['set_id','set_name','set_series','set_logo_url',
                           'release_date','total_cards','ct_expansion_id']);
    }
    if (foglioCarte.getLastRow() === 0) {
      foglioCarte.appendRow(['id','name','set_id','set_name','set_series','number',
                             'rarity','types','image_url_small','image_url_large',
                             'set_logo_url','last_updated','blueprint_id']);
    }

    // ---- 4. Sync incrementale: segna i set GIÀ in cache per saltarli ----
    var setGiaElaborati = {};
    var righeSetInCache = foglioSet.getDataRange().getValues();
    for (var r = 1; r < righeSetInCache.length; r++) {
      if (righeSetInCache[r][0]) setGiaElaborati[Number(righeSetInCache[r][0])] = true;
    }

    // ---- 5. Riprendi dal cursore salvato ----
    var cursoreSalvato = String(stato.catalog_cursor || '');
    var idSetCursore   = (cursoreSalvato && cursoreSalvato !== 'DONE')
      ? parseInt(cursoreSalvato, 10)
      : 0;

    var indicePartenza = 0;
    if (idSetCursore > 0) {
      for (var k = 0; k < espansioniDaScaricare.length; k++) {
        if (espansioniDaScaricare[k].id === idSetCursore) {
          indicePartenza = k + 1;
          break;
        }
      }
    }

    var contatoreNuoviSet = 0;

    // ---- 6. Ciclo principale: un set alla volta ----
    for (var s = indicePartenza; s < espansioniDaScaricare.length; s++) {

      // Timeout in arrivo? Salva il cursore e riprogramma il prossimo hop.
      if (Date.now() - istanteInizio > SYNC_LIMITE_MS) {
        _scriviStatoSync('catalog_cursor', String(espansioniDaScaricare[s > 0 ? s - 1 : 0].id));
        Logger.log('[SYNC] Limite tempo raggiunto a ' + s + '/' +
                   espansioniDaScaricare.length + ' → riprogrammo.');
        _programmaProssimoHopSync();
        return;
      }

      var espansione = espansioniDaScaricare[s];
      if (setGiaElaborati[espansione.id]) {
        _scriviStatoSync('catalog_cursor', String(espansione.id));
        continue; // già in cache: salta
      }

      // ---- 6a. Scarica tutti i blueprint (prodotti) dell'espansione ----
      var blueprintDelSet = chiamaCardTrader(
        URL_BASE_API_CARDTRADER + '/blueprints/export?expansion_id=' + espansione.id,
        apiKey
      );
      if (blueprintDelSet._error || !Array.isArray(blueprintDelSet)) {
        Logger.log('[SYNC] Skip ' + espansione.name + ': ' +
                   (blueprintDelSet._error || 'non array'));
        _scriviStatoSync('catalog_cursor', String(espansione.id));
        continue;
      }

      // ---- 6b. Tieni solo le carte singole ----
      var carteSingole = blueprintDelSet.filter(function(blueprint) {
        return blueprint.category_id === ID_CATEGORIA_CARTA_SINGOLA;
      });
      if (carteSingole.length === 0) {
        Logger.log('[SYNC] Skip ' + espansione.name + ': nessuna carta singola');
        _scriviStatoSync('catalog_cursor', String(espansione.id));
        continue;
      }

      // ---- 6c. Classifica il set come Giapponese (JP) o Internazionale (INT) ----
      var serieDelSet = 'INT';
      var proprietaModificabili = carteSingole[0].editable_properties || [];
      for (var p = 0; p < proprietaModificabili.length; p++) {
        if (proprietaModificabili[p].name === 'pokemon_language') {
          serieDelSet = proprietaModificabili[p].default_value === 'jp' ? 'JP' : 'INT';
          break;
        }
      }
      Logger.log('[SYNC] ' + espansione.name + ' → ' + serieDelSet +
                 ' (' + carteSingole.length + ' carte)');

      // ---- 6d. Per i set internazionali: logo e data da GitHub ----
      var urlLogoSet = '';
      var dataUscita = '';
      if (serieDelSet === 'INT') {
        var datiGithub = getGithubSetsMap()[espansione.name.toLowerCase()];
        if (datiGithub) {
          urlLogoSet = datiGithub.logo;
          dataUscita = datiGithub.releaseDate;
        }
      }

      // ---- 6e. Scrivi la riga del set in SET_CACHE ----
      foglioSet.appendRow([
        String(espansione.id), espansione.name, serieDelSet,
        urlLogoSet, dataUscita, carteSingole.length, espansione.id
      ]);

      // ---- 6f. Prepara le righe delle carte e scrivile in batch ----
      var righeCarte = carteSingole.map(function(blueprint) {
        var numeroCollezione = (blueprint.fixed_properties &&
                                blueprint.fixed_properties.collector_number) || '';
        var rarita           = (blueprint.fixed_properties &&
                                blueprint.fixed_properties.pokemon_rarity) || '';

        var variante = (blueprint.version || '').split('|')[0].trim();
        var raritaDaMostrare =
          (variante && variante.toLowerCase() !== rarita.toLowerCase())
            ? (rarita ? rarita + ' · ' + variante : variante)
            : rarita;

        var idCarta = String(espansione.id) + '_' + blueprint.id;

        return [
          idCarta,                       // id
          blueprint.name,                // name
          String(espansione.id),         // set_id
          espansione.name,               // set_name
          serieDelSet,                   // set_series (INT/JP)
          numeroCollezione,              // number
          raritaDaMostrare,              // rarity
          '',                            // types (non fornito da CardTrader)
          blueprint.image_url || '',     // image_url_small
          blueprint.image_url || '',     // image_url_large
          '',                            // set_logo_url (sta in SET_CACHE)
          dataOraAdesso,                 // last_updated
          blueprint.id                   // blueprint_id (serve per i prezzi)
        ];
      });

      if (righeCarte.length > 0) {
        foglioCarte
          .getRange(foglioCarte.getLastRow() + 1, 1, righeCarte.length, 13)
          .setValues(righeCarte);
      }

      // ---- 6g. Set completato: aggiorna cursore ----
      setGiaElaborati[espansione.id] = true;
      contatoreNuoviSet++;
      _scriviStatoSync('catalog_cursor', String(espansione.id));
    }

    // ---- 7. Giro completato su tutti i set ----
    _scriviStatoSyncMulti({
      catalog_cursor:    'DONE',
      catalog_last_sync: dataOraAdesso,
      catalog_running:   'false'
    });
    Logger.log('[SYNC] Completata. Nuovi set in questo giro: ' + contatoreNuoviSet);

  } catch (errore) {
    // Errore inatteso: libero il semaforo per non bloccare i giri futuri.
    Logger.log('[SYNC] Errore: ' + errore.message + ' → libero il semaforo.');
    try { _scriviStatoSync('catalog_running', 'false'); } catch (e) {}
  }
}



// ════════════════════════════════════════════════════════════════════
// LETTURA DEL CATALOGO DALLA CACHE (funzioni chiamate dal frontend)
// ════════════════════════════════════════════════════════════════════
// Strategia "lazy loading": all'apertura del catalogo il frontend chiede
// SOLO la lista dei set (getSetList). Le carte di un set vengono caricate
// solo quando l'utente lo espande (getCardsForSet). Questo rende
// l'apertura della pagina molto più veloce.
// ════════════════════════════════════════════════════════════════════

/**
 * Restituisce la lista di tutti i set in cache (senza le carte).
 */
function getSetList(token) {
  try {
    requireAuth(token);

    var foglioSet  = getSheet('SET_CACHE');
    var ultimaRiga = foglioSet.getLastRow();
    if (ultimaRiga <= 1) return { success: true, sets: [], empty: true };

    var righe = foglioSet.getRange(1, 1, ultimaRiga, 7).getValues();
    var listaSet = [];

    for (var i = 1; i < righe.length; i++) { // i=1 salta l'intestazione
      var riga = righe[i];
      if (!riga[0]) continue; // salta righe vuote
      listaSet.push({
        set_id:          String(riga[0]),
        set_name:        String(riga[1] || ''),
        set_series:      String(riga[2] || ''),       // 'INT' o 'JP'
        set_logo_url:    String(riga[3] || ''),
        release_date:    String(riga[4] || ''),
        total_cards:     Number(riga[5] || 0),
        ct_expansion_id: Number(riga[6] || riga[0])
      });
    }

    return {
      success:   true,
      sets:      listaSet,
      empty:     listaSet.length === 0,
      last_sync: String(_leggiStatoSync().catalog_last_sync || '')
    };
  } catch (errore) {
    if (errore.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: errore.message };
  }
}

/**
 * Restituisce tutte le carte di UN set.
 * Chiamata dal frontend quando l'utente espande l'intestazione di un set.
 */
function getCardsForSet(token, setId) {
  try {
    requireAuth(token);

    var foglioCarte = getSheet('CACHE_CARDS');
    var ultimaRiga  = foglioCarte.getLastRow();
    if (ultimaRiga <= 1) return { success: true, cards: [] };

    var righe       = foglioCarte.getRange(1, 1, ultimaRiga, 13).getValues();
    var carteDelSet = [];
    var idSetCercato = String(setId);

    for (var i = 1; i < righe.length; i++) {
      if (!righe[i][0]) continue;
      if (String(righe[i][2]) === idSetCercato) { // colonna 3 (indice 2) = set_id
        try { carteDelSet.push(convertiRigaInCarta(righe[i])); } catch (e) { continue; }
      }
    }

    return { success: true, cards: carteDelSet };
  } catch (errore) {
    if (errore.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: errore.message };
  }
}

/**
 * Restituisce le carte corrispondenti a una lista di ID.
 * Usata dalla sezione Portfolio per caricare in un colpo solo i metadati
 * (nome, immagine, set...) di tutte le carte possedute.
 */
function getCardsForIds(token, cardIds) {
  try {
    requireAuth(token);
    if (!cardIds || !cardIds.length) return { success: true, cards: [] };

    var foglioCarte = getSheet('CACHE_CARDS');
    var ultimaRiga  = foglioCarte.getLastRow();
    if (ultimaRiga <= 1) return { success: true, cards: [] };

    // Trasforma la lista di ID in un dizionario per ricerca veloce O(1).
    var idDaCercare = {};
    cardIds.forEach(function(id) { idDaCercare[String(id)] = true; });

    var righe = foglioCarte.getRange(1, 1, ultimaRiga, 13).getValues();
    var carteTrovate = [];

    for (var i = 1; i < righe.length; i++) {
      if (!righe[i][0]) continue;
      if (idDaCercare[String(righe[i][0])]) {
        try { carteTrovate.push(convertiRigaInCarta(righe[i])); } catch (e) { continue; }
      }
    }

    return { success: true, cards: carteTrovate };
  } catch (errore) {
    if (errore.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: errore.message };
  }
}

/**
 * Ricerca carte per nome (sottostringa, case-insensitive).
 * Usata dalla barra di ricerca del catalogo. Richiede almeno 2 caratteri.
 */
function searchCards(token, testoCercato) {
  try {
    requireAuth(token);
    if (!testoCercato || testoCercato.trim().length < 2) {
      return { success: true, cards: [] };
    }

    var foglioCarte = getSheet('CACHE_CARDS');
    var ultimaRiga  = foglioCarte.getLastRow();
    if (ultimaRiga <= 1) return { success: true, cards: [] };

    var righe     = foglioCarte.getRange(1, 1, ultimaRiga, 13).getValues();
    var query     = testoCercato.trim().toLowerCase();
    var risultati = [];

    for (var i = 1; i < righe.length; i++) {
      if (!righe[i][0]) continue;
      // colonna 2 (indice 1) = nome carta
      if (String(righe[i][1]).toLowerCase().indexOf(query) !== -1) {
        risultati.push(convertiRigaInCarta(righe[i]));
      }
    }

    return { success: true, cards: risultati };
  } catch (errore) {
    if (errore.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: errore.message };
  }
}

/**
 * Converte una riga "grezza" del foglio CACHE_CARDS in un oggetto carta
 * con campi nominati, pronto per essere inviato al frontend.
 *
 * Indici colonne (0-based):
 *   0=id  1=name  2=set_id  3=set_name  4=set_series  5=number  6=rarity
 *   7=types  8=image_url_small  9=image_url_large  10=set_logo_url
 *   11=last_updated  12=blueprint_id
 */
function convertiRigaInCarta(riga) {
  return {
    id:              String(riga[0]),
    name:            String(riga[1]  || ''),
    set_id:          String(riga[2]  || ''),
    set_name:        String(riga[3]  || ''),
    set_series:      String(riga[4]  || ''),
    number:          String(riga[5]  || ''),
    rarity:          String(riga[6]  || ''),
    types:           String(riga[7]  || ''),
    image_url_small: String(riga[8]  || ''),
    image_url_large: String(riga[9]  || ''),
    set_logo_url:    String(riga[10] || ''),
    blueprint_id:    riga[12] ? Number(riga[12]) : null,
    is_jp:           String(riga[4] || '') === 'JP' // comodo flag per il frontend
  };
}