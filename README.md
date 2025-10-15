# VOX - Conversational Voice Agent

A multilingual conversational AI agent powered by ElevenLabs, featuring real-time audio visualization, geographic location awareness, and 30+ integrated tools including weather, news, search, image gallery, navigation, flight search, and academic research.

## Team Members
- Alec Fritsch (@flokzybtw)
- Mehmet Ali Dolgun (@psychip_)

## Live Demo
[vox.psychip.net](https://vox.psychip.net)

## Project Overview

This application demonstrates an advanced conversational AI interface with:
- **Real-time voice conversation** using ElevenLabs Conversational AI
- **Multi-language support** with Turkish, English, German, and Spanish
- **Dynamic audio visualization** with speech activity detection
- **Geographic awareness** with IP-based location detection
- **30+ integrated tools** for weather, news, search, navigation, flights, and more
- **Touch-friendly interface** with automatic device detection
- **Image gallery system** with automated visual search and modal view
- **Responsive web interface** with mobile optimization

## Available Tools

### Information & Search
- **web-search** - Search the web using Google
  - *"Search for quantum computing"*
  - *"Look up climate change effects"*

- **image-search** - Find images across the web
  - *"Show me pictures of Mount Everest"*
  - *"Find images of sports cars"*
  - **Automatically triggers** when discussing celebrities, places, landmarks, movies, products, animals, or any visual subject

- **latest-news** - Get recent news articles by location or topic
  - *"What's the latest news?"*
  - *"Get technology news"*
  - *"News about Istanbul"*
  - Automatically filters out sports news unless specifically requested

- **latest-earthquakes** - Check recent earthquakes near location
  - *"Any earthquakes nearby?"*
  - *"Recent earthquakes in California"*
  - Reports magnitude, location, and depth

### Weather & Location
- **get-weather** - Get current weather and forecast
  - *"What's the weather?"*
  - *"Weather in London"*
  - *"Will it rain today?"*

- **poi-search** - Find nearby points of interest
  - *"Find a hospital nearby"*
  - *"Where's the nearest gas station?"*
  - *"Show me restaurants"*
  - Types: hospital, pharmacy, gas station, charging station, atm, parking, hotel, cafe, bank, police

- **save-location** - Save current location as KML file
  - *"Save this location"*
  - *"Mark this as parking spot"*

- **local-events** - Find upcoming local events
  - *"What's happening this weekend?"*
  - *"Any concerts in Berlin?"*

- **get-address** - Reverse geocoding to identify current location
  - *"Where am I?"*
  - *"What is this place?"*
  - *"I'm lost"*

### Travel & Navigation
- **flight-search** - Search for available flights between cities
  - *"Find flights to Berlin"*
  - *"Flights from Istanbul to Berlin tomorrow"*
  - *"Fly to London today"*
  - Automatically finds airport IATA codes via web search for any city
  - Supports date parsing (today, tomorrow, YYYY-MM-DD)
  - Converts USD prices to local currency

- **Google Maps Navigation** - Get driving directions
  - *"Navigate to Istanbul"*
  - *"Take me to the airport"*
  - *"Directions to the nearest hospital"*

- **Hotel Search** - Find accommodation via Hotels.com
  - *"Find a hotel"*
  - *"Hotels in Paris"*
  - *"Where to stay in Tokyo"*

### Media & Entertainment
- **music-search** - Search and play music
  - *"Play Bohemian Rhapsody"*
  - *"Play Mozart Symphony No 40"*

- **YouTube Search** - Find videos and music
  - *"Show me the Thriller music video"*
  - *"How to tie a tie"*

- **SoundCloud Search** - Find music, remixes, DJ sets
  - *"Find lo-fi hip hop on SoundCloud"*
  - *"Search for deadmau5 live set"*

### Shopping
- **Amazon Search** - Search for products
  - *"Find wireless headphones on Amazon"*
  - *"Search for Sony cameras"*

- **eBay Search** - Find used items, collectibles
  - *"Find used MacBook Pro on eBay"*
  - *"Search for vintage watches"*

- **app-search** - Find apps for your platform
  - *"Find Spotify"*
  - *"Search for WhatsApp"*
  - Auto-detects platform (Android/iOS/Windows/Linux)

### Academic & Research
- **Google Scholar** - Search academic papers across all disciplines
  - *"Find research on climate change"*

- **Semantic Scholar** - AI-powered academic search with citation context
  - *"Find machine learning papers"*

- **PubMed** - Medical and life sciences research
  - *"Search for diabetes treatment research"*

- **JSTOR** - Humanities and social sciences archives
  - *"Find articles on ancient philosophy"*

- **ResearchGate** - Academic networking and paper sharing
  - *"Find papers on renewable energy"*

### Social Media
- **Reddit Search** - Find community discussions
  - *"Search Reddit for gaming PC builds"*

- **X/Twitter Search** - Real-time updates and reactions
  - *"Search Twitter for AI news"*

### Entertainment Info
- **IMDB Search** - Find movies, TV shows, actors
  - *"Find Inception on IMDB"*
  - *"Search for Breaking Bad"*

### Utilities
- **calculator** - Complex mathematical calculations
  - *"Calculate square root of 144 plus 5 squared"*
  - *"Convert 3.5 inches to centimeters"*
  - *"Multiply matrix [1,2][3,4] by [5,6][7,8]"*

- **currency-convert** - Convert between currencies
  - *"Convert 100 USD to EUR"*
  - *"How much is 50 dollars in my currency?"*

- **visible-aircraft** - Check aircraft overhead
  - *"How many planes are in the sky?"*
  - *"Show visible aircraft"*

- **author** - Generate long-form content (recipes, code, guides)
  - *"Write a Python script to backup files"*
  - *"Give me a chocolate cake recipe"*
  - *"Create a Linux installation guide"*

### Image Gallery
- **pick-card** - Randomly select and open an image with personalized comment
  - *"Pick one"*
  - *"Show me one"*
  - *"Open one of those"*
  - Agent provides unique contextual comments for each selection

- **next-card** - Navigate to next image in modal
  - *"Next"*
  - *"Show me another"*

- **close-card** - Close image modal
  - *"Close"*
  - *"That's enough"*

### Personal
- **take-note** - Capture spoken notes
  - *"Take a note: meeting at 3 PM"*
  - *"Remember to buy milk"*

- **save-name** - Save your name for personalization
  - *"My name is John"*
  - *"I'm Sarah"*

### System
- **volume-adjust** - Adjust master volume by 10%
  - *"Turn it up"*
  - *"I can't hear you"*
  - *"Too loud"*
  - Recognizes casual volume requests

- **reset** - Factory reset with data clearing
  - *"Forget about me"*
  - *"Delete everything"*
  - *"Reset to factory settings"*
  - Clears all user data and preferences

- **end-session** - End conversation
  - *"Goodbye"*
  - *"End session"*

## Keyboard Shortcuts

- **Tab** - Toggle text input window
- **\` (Backtick)** - Toggle debug console
- **Escape** - Close image modal
- **Arrow Left** - Previous image in modal
- **Arrow Right** - Next image in modal

## Core Technologies
- **Node.js** with Express.js server
- **Webpack** for module bundling
- **Web Audio API** for real-time audio processing
- **Canvas API** for audio visualization and image gallery
- **MaxMind GeoIP2** for location detection

## APIs & Services
- **ElevenLabs API** - Voice synthesis and conversation management
- **SerpAPI** - Web search, image search, news, events, and flight data
- **OpenWeather API** - Weather information and forecasts
- **Google Places API** - Points of interest search
- **AltınKaynak API** - Turkish Lira currency rates
- **OpenExchangeRates API** - Global currency conversion
- **EMSC & USGS** - Earthquake data feeds
- **MaxMind GeoLite2** - Local IP geolocation
- **AviationStack API** - Visible aircraft tracking
- **Math.js** - Complex mathematical calculations

## Installation & Setup

### 1. Clone the Repository
```bash
git clone https://github.com/psychip/berlin-hackathon
cd berlin-hackathon
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Environment Configuration
Create a `.env` file in the root directory:
```env
# ElevenLabs Configuration
XI_API_KEY=your_elevenlabs_api_key
AGENT_ID=your_elevenlabs_agent_id

# API Keys
SERPAPI_KEY=your_serpapi_key
OPENWEATHER_KEY=your_openweather_key
OPENEXCHANGERATES_KEY=your_openexchangerates_key
GPLACES_KEY=your_google_places_key

# Server Configuration
PORT=3388
```

### 4. Database Setup
The application includes MaxMind GeoLite2 databases for IP geolocation:
- `db/GeoLite2-City.mmdb` - City-level geolocation
- `db/GeoLite2-ASN.mmdb` - ISP/Organization data

These are included in the repository for development purposes.

## Running the Application

```bash
npm run build
node server.js
```

The application will be available at `http://localhost:3388`

## Project Structure

```
VOX/
├── src/                    # Frontend source files
│   ├── app.js             # Main application logic
│   ├── index.html         # HTML template
│   ├── styles.css         # Stylesheets
├── dist/                  # Built/compiled files
│   ├── bundle.js          # Webpack compiled bundle
│   ├── index.html         # Production HTML
│   └── static/            # Static assets (sound effects)
├── content/               # Agent configuration
│   ├── system.md          # System prompt and tool definitions
│   ├── drift.md           # Critical reminders
│   ├── character.md       # Character definitions
│   ├── greetings.json     # Greeting templates
│   └── tool.md            # Tool implementation guide
├── db/                    # Databases
│   ├── GeoLite2-*.mmdb   # MaxMind GeoIP databases
│   ├── api.json          # API endpoint configurations
│   ├── currency.json     # Currency data
│   └── lang.json         # Language settings
├── server.js              # Express.js backend server
├── token.py              # Token counter utility
├── webpack.config.js      # Webpack configuration
└── package.json          # Project dependencies
```

## Language Support

VOX supports 4 languages with full localization:

- **Turkish (tr)** - Türkçe - Default for Turkey
- **English (en)** - English - Default for most regions
- **German (de)** - Deutsch - Default for Germany, Austria, Switzerland
- **Spanish (es)** - Español - Default for Spain and Latin America

Language is automatically detected from user's IP location and can be changed via the language selection screen on first launch.

## Configuration

### Audio Processing
- **FFT Size**: 256 (standard), 64 (low-end devices)
- **Smoothing**: 0.6 (standard), 0.25 (low-end)
- **Speech Detection Threshold**: 15
- **Silence Detection**: 800ms pause for sentence end
- **Subtitle Speed**: 75 characters per second

### Touch UI (Tablets/Smartphones)
- **UI Timeout**: 5000ms (5 seconds) - configurable in `src/app.js` via `TOUCH_UI_TIMEOUT`
- Controls auto-hide after timeout, reappear on touch

### Visualization
- **Circle Radius**: 80px
- **Audio Multiplier**: 40 (standard), 15 (low-end)
- **Color Speed**: 10
- **Glow Effect**: 8 (disabled on low-end devices)

### Performance Optimization
- Automatic device capability detection
- Low-end mode for devices with <8GB RAM
- Manual override: `?lowperf=true/false`

## Features

### Audio Visualization
- Real-time FFT analysis
- Circular spectrum display with rotation
- Speech activity detection with visual feedback
- Agent/user state differentiation
- Performance-adaptive rendering

### Image Gallery
- Animated image display with random placement
- Collision detection and smart layout
- Click to view full-size in modal
- Keyboard navigation (arrow keys)
- Automatic fade-out on disconnect
- Hover effects with scaling

### Touch-Friendly UI
- Automatic touch device detection
- Auto-hiding controls after 5 seconds
- Show on touch/tap
- Affects volume bar, call controls, topic display

### Subtitle System
- Intelligent sentence splitting (respects abbreviations like "Mr.", "Dr.")
- Dynamic display timing (30 chars/second)
- Automatic handling of transcription errors

### Topic Display
- Shows current conversation topic
- Color-coded tags
- Hover to view (desktop) or touch to show (mobile)
- Persists across sessions

### Conversation Management
- Time-based greetings
- **Multi-language support**: Turkish, English, German, Spanish
- Location and timezone awareness
- Session history tracking
- Error handling with audio feedback
- Proactive image search for visual subjects
- Automatic tool triggering based on context

## Common Issues

**Agent Not Connecting**
- Verify ElevenLabs API key and Agent ID
- Check network connectivity
- Confirm microphone permissions

**Performance Issues**
- Try low performance mode: `?lowperf=true`
- Close other audio applications
- Use supported browsers (Chrome, Firefox, Safari)

**No Audio/Microphone**
- Grant microphone permissions
- Check microphone is not stereo mix
- Verify no other application is using microphone

## Development

### Adding New Tools
1. Define tool in `content/system.md` with trigger patterns and examples
2. Add API endpoint to `db/api.json` if needed
3. Implement handler in `server.js` (for server-side tools)
4. Add client-side handler in `src/app.js` if needed
5. Test tool across all supported languages

### Adding New Languages
1. Create language folder in `content/[language-code]/`
2. Add `agent.md` with localized instructions
3. Add `greetings.json` with time-based greeting templates
4. Update `db/lang.json` with language configuration
5. Add language card to `src/index.html`
6. Test all tools and responses in new language

### Modifying System Prompt
Edit `content/system.md` - changes apply immediately after agent restart.

### Adjusting Touch UI Timeout
Modify `TOUCH_UI_TIMEOUT` constant in `src/app.js` (line 20).

## Browser Compatibility
- **Chrome/Edge**: Full support ✅
- **Firefox**: Full support ✅
- **Safari**: Full support ✅
- **Mobile browsers**: Touch-optimized ✅

## License

This project is developed for educational and demonstration purposes as part of the {Tech:Europe} Berlin Hackathon 2025.

---

Built with ❤️ in 48 hours for the Berlin Hackathon
