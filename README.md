# Conversational Voice Agent with Tool Support

A conversational AI agent powered by ElevenLabs, featuring real-time audio visualization, geographic location awareness, and integrated tool capabilities including weather, directions, and search functionality.

## Team Members
- Alec Fritsch (@flokzybtw)
- Mehmet Ali Dolgun (@psychip_)

## Live Demo
[vox.psychip.net](https://vox.psychip.net)

## Project Overview

This application demonstrates an advanced conversational AI interface with:
- **Real-time voice conversation** using ElevenLabs Conversational AI
- **Dynamic audio visualization** with speech activity detection
- **Geographic awareness** with IP-based location detection
- **Integrated tools** for weather, directions, and search
- **Responsive web interface** with mobile optimization

### Core Technologies
- **Node.js** with Express.js server
- **Webpack** for module bundling and development
- **Web Audio API** for real-time audio processing
- **Canvas API** for audio visualization
- **MaxMind GeoIP2** for location detection

### APIs & Services
- **ElevenLabs API** - Voice synthesis and conversation management
- **Google Routes API** - Driving directions (11labs tool)
- **OpenWeather API** - Weather information  (11labs tool)
- **Google Custom Search API** - Web search capabilities (11labs tool)
- **MaxMind GeoLite2** - Local IP geolocation databases

### Frontend Libraries
- **Sound.js** - Sound effects and noise generation
- **Web Audio API** - Real-time audio analysis and effects

## Prerequisites
- **Node.js** (v16 or higher)
- **npm** package manager
- **ElevenLabs account** with API access
- **Google Cloud Platform** account (for Routes and Search APIs)
- **SerpAPI** for local news
- **OpenWeather** account for weather data

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

# Server Configuration
PORT=3388
```

note: google cloud and serpapi keys hardcoded into 11labs tool calls

### 4. ElevenLabs Agent Setup
1. Create an account at [ElevenLabs](https://elevenlabs.io)
2. Navigate to the Conversational AI section
3. Create a new agent with the following configuration:
   - **Voice**: Choose your preferred voice model
   - **Tools**: Enable the following tools:

take a look to the screenshots in ./doc folder for detailed setup

4. Copy the Agent ID to your `.env` file

### 5. Database Setup
The application includes MaxMind GeoLite2 databases for IP geolocation:
- `db/GeoLite2-City.mmdb` - City-level geolocation
- `db/GeoLite2-ASN.mmdb` - ISP/Organization data

These are included in the repository for development purposes.

## Running the Application

```bash
npm run build
node server.js
```

## Project Structure

```
berlin-hackathon/
├── src/                    # Frontend source files
│   ├── app.js             # Main application logic
│   ├── index.html         # HTML template
│   ├── styles.css         # Stylesheets
├── dist/                  # Built/compiled files
│   ├── bundle.js          # Webpack compiled bundle
│   ├── index.html         # Production HTML
│   └── static/            # Static assets
├── db/                    # MaxMind GeoIP databases
│   ├── GeoLite2-City.mmdb
│   └── GeoLite2-ASN.mmdb
├── server.js              # Express.js backend server
├── system_prompt.txt      # AI agent system prompt
├── webpack.config.js      # Webpack configuration
├── package.json           # Project dependencies
└── README.md             # This documentation
```

## Configuration Details

### Audio Processing
- **FFT Size**: 256 (standard), 64 (low-end devices)
- **Smoothing**: 0.6 (standard), 0.25 (low-end)
- **Speech Detection Threshold**: 15 (adjustable)
- **Silence Detection**: 800ms pause for sentence end

### Visualization Settings
- **Circle Radius**: 80px
- **Audio Multiplier**: 40 (standard), 15 (low-end)
- **Color Speed**: 10
- **Glow Effect**: 8 (disabled on low-end devices)

### Performance Optimization
The application automatically detects device capabilities:
- **Mobile devices** or devices with <8GB RAM use optimized settings
- **Manual override** available via URL parameter: `?lowperf=true/false`

## API Integrations

### ElevenLabs Conversational AI
- Real-time voice synthesis and recognition
- Custom system prompts with location awareness
- Tool integration for external API calls
- WebSocket-based communication

### Location Services
- IP-based geolocation using MaxMind GeoLite2
- Automatic timezone and location detection
- Privacy-focused (no external API calls for basic geolocation)

## Features

### Audio Visualization
- Real-time FFT analysis
- Circular spectrum display with rotation
- Speech activity detection with visual feedback
- Agent/user state differentiation
- Performance-adaptive rendering

### Conversation Management
- Automatic greeting based on time of day
- Subtitle display
- List formatting for structured responses
- Connection status monitoring
- Error handling with audio feedback

### Common Issues

**Agent Not Connecting**
- Verify ElevenLabs API key and Agent ID
- Check network connectivity
- Confirm agent configuration matches requirements

**Performance Issues**
- Try low performance mode: `?lowperf=true`
- Close other audio applications
- Use supported browsers (Chrome, Firefox, Safari)

This project was developed for {Tech:Europe} 19/07/2025 Berlin Hackathon competition in 48 hours. For evaluation purposes, please review:
1. Code architecture and organization
2. API integration implementations
3. Real-time audio processing
4. User experience design
5. Error handling and performance optimization

## 📄 License

This project is developed for educational and demonstration purposes as part of a hackathon competition.

