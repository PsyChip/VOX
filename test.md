# VOX Agent Tool Test Suite

This document contains test sentences for all external tools to verify agent behavior and tool triggering.

## Search & Information Tools

### web-search
**Purpose**: Runs a Google search and returns top results with snippets.

**Test sentences**:
- "search for latest AI developments"
- "look up climate change effects"
- "find information about quantum computing"
- "research electric vehicles"

**Expected response**:
```xml
<action cmd="web-search" param="latest AI developments">Looking that up</action>
```

---

### get-weather
**Purpose**: Retrieves current weather and forecast for a location.

**Test sentences**:
- "what's the weather like"
- "will it rain today"
- "how's the weather in London"
- "check the weather"

**Expected response**:
```xml
<action cmd="get-weather" param="{{location}}">Checking the weather</action>
```

---

### latest-news
**Purpose**: Retrieves recent news articles for a location or topic.

**Test sentences**:
- "what's the latest news"
- "show me local news"
- "news about technology"
- "what's happening in the world"

**Expected response**:
```xml
<action cmd="latest-news" param="{{location}}">Getting local news</action>
```

---

### image-search
**Purpose**: Searches for images across the web.

**Test sentences**:
- "who is Angelina Jolie"
- "what is the Eiffel Tower"
- "show me pictures of sports cars"
- "tell me about Mount Everest"

**Expected response**:
```xml
Angelina Jolie is an American actress... <action cmd="image-search" param="Angelina Jolie actress"/>
```

---

### currency-convert
**Purpose**: Converts currency amounts using live exchange rates.

**Test sentences**:
- "convert one hundred dollars to euros"
- "how much is fifty euros in dollars"
- "convert two hundred pounds to my currency"

**Expected response**:
```xml
<action cmd="currency-convert" param="100 USD EUR">Converting one hundred U S dollars to euros</action>
```

---

### latest-earthquakes
**Purpose**: Looks for recent earthquakes near user's location.

**Test sentences**:
- "any recent earthquakes"
- "check for earthquakes nearby"
- "were there earthquakes today"

**Expected response**:
```xml
<action cmd="latest-earthquakes" param="{{lat}},{{lon}}">Checking for recent earthquakes</action>
```

---

## Navigation & Location Tools

### poi-search
**Purpose**: Finds points of interest near user's coordinates.

**Test sentences**:
- "find a hospital"
- "where is the nearest gas station"
- "look for a pharmacy"
- "find an ATM nearby"
- "where's the closest restaurant"

**Expected response**:
```xml
<action cmd="poi-search" param="hospital">Finding nearby hospitals</action>
```

**Expected final response**:
```
There is a hospital named City Hospital at four hundred meters away.
```

---

### local-events
**Purpose**: Searches for upcoming local events.

**Test sentences**:
- "what's happening tonight"
- "any concerts this weekend"
- "show me local events"
- "things to do today"

**Expected response**:
```xml
<action cmd="local-events" param="{{location}}">Looking for events</action>
```

---

### visible-aircraft
**Purpose**: Retrieves aircraft currently visible in the sky.

**Test sentences**:
- "what planes are overhead"
- "show me visible aircraft"
- "any planes flying above"

**Expected response**:
```xml
<action cmd="visible-aircraft" param="{{lat}},{{lon}}">Checking visible aircraft</action>
```

---

### get-address
**Purpose**: Reverse geocodes coordinates to human-readable address.

**Test sentences**:
- "where am I"
- "what is my location"
- "what street am I on"
- "tell me my address"

**Expected response**:
```xml
<action cmd="get-address" param="{{lat}},{{lon}}">Finding your location</action>
```

**Expected final response**:
```
You're on Main Street in Downtown District.
```

---

### flight-search
**Purpose**: Searches for available flights between airports.

**Test sentences**:
- "find flights to Berlin"
- "flights from Istanbul to Berlin tomorrow"
- "can I fly to London today"
- "search for flights to Paris"

**Expected response**:
```xml
<action cmd="flight-search" param="{{location}}|Berlin|today">Looking for flights to Berlin</action>
```

**Expected flow**:
1. Call flight-search
2. Receive flight with USD price
3. Call currency-convert
4. Speak: "Tomorrow three thirty PM, Turkish Airlines, four hundred euros"

---

## Content Generation Tools

### author
**Purpose**: Routes long-form content to specialized sub-agent.

**Test sentences**:
- "write me a chocolate cake recipe"
- "create a python script to process CSV files"
- "write a short story about space"
- "generate a bash script for backups"

**Expected response**:
```xml
<action cmd="author" param="chocolate cake recipe with ingredients and baking instructions">Preparing chocolate cake recipe, please wait..</action>
```

---

### calculator
**Purpose**: Evaluates complex mathematical expressions.

**Test sentences**:
- "what is the square root of one hundred forty four"
- "calculate sine of forty five degrees"
- "convert three point five inches to centimeters"

**Expected response**:
```xml
<action cmd="calculator" param="sqrt(144)">Calculating</action>
```

---

## Client-Side Tools

### save-name
**Purpose**: Saves user's name for personalization.

**Test sentences**:
- "my name is John"
- "I'm Sarah"
- "call me Mike"

**Expected response**:
```xml
<action cmd="save-name" param="John">Nice to meet you John!</action>
```

---

### take-note
**Purpose**: Captures spoken notes verbatim.

**Test sentences**:
- "take a note: buy milk and eggs"
- "remember that I need to call the dentist"
- "note this down: meeting tomorrow at three PM"

**Expected response**:
```xml
<action cmd="take-note" param="shopping_list_items|Buy milk and eggs">Saved your shopping list items</action>
```

**Expected file**: `shopping_list_items.md`

---

### save-location
**Purpose**: Saves current location as KML file.

**Test sentences**:
- "save this location"
- "mark this spot as parking"
- "save current location as meeting point"

**Expected response**:
```xml
<action cmd="save-location" param="Parking Spot">Saving this location as Parking Spot</action>
```

**Expected file**: `Parking_Spot.kml`

---

### volume-adjust
**Purpose**: Adjusts master output volume by 10%.

**Test sentences**:
- "turn it up"
- "louder please"
- "I can't hear you"
- "turn it down"
- "too loud"

**Expected response**:
```xml
<action cmd="volume-adjust" param="up"/>
```

---

### language-switch
**Purpose**: Switches interface and agent language.

**Test sentences**:
- "switch to German"
- "change language to Spanish"
- "speak Turkish"

**Expected response**:
```xml
<action cmd="language-switch" param="de">Switching to German</action>
```

---

### end-session
**Purpose**: Ends the conversation session.

**Test sentences**:
- "goodbye"
- "bye"
- "end session"
- "disconnect"

**Expected response**:
```xml
<action cmd="end-session" param="">Goodbye, ending the session now.</action>
```

**Should NOT trigger on**:
- "let's go" (navigation)
- "let's go to Berlin" (navigation)

---

### tune-behaviour
**Purpose**: Records user requests to change agent behavior.

**Test sentences**:
- "you should not provide proverbs on start"
- "stop asking me if I want more details"
- "from now on say hello instead of hi"
- "you shouldn't talk so much"

**Expected response**:
```xml
<action cmd="tune-behaviour" param="response-style|Avoid proverbs in greetings|You should not provide proverbs on start">Understood, I'll skip that</action>
```

---

### app-search
**Purpose**: Searches for applications in appropriate app store.

**Test sentences**:
- "find Spotify"
- "search for WhatsApp"
- "download Discord"

**Expected response**:
```xml
<action cmd="app-search" param="spotify">Searching for Spotify</action>
```

---

## Media & Gallery Tools

### pick-card
**Purpose**: Randomly selects and opens a gallery image.

**Test sentences** (after image-search has loaded images):
- "pick one"
- "show me one"
- "open one of those"
- "let me see one"

**Expected response**:
```xml
<action cmd="pick-card"/>
```

---

### next-card
**Purpose**: Shows next image in gallery when modal is open.

**Test sentences** (while viewing image):
- "next"
- "show me another"
- "next one"

**Expected response**:
```xml
<action cmd="next-card"/>
```

---

### close-card
**Purpose**: Closes the image modal.

**Test sentences** (while viewing image):
- "close"
- "okay"
- "thanks"
- "that's enough"

**Expected response**:
```xml
<action cmd="close-card"/>
```

---

## Third Party Services (Links)

### Show Location on Map
**Purpose**: Opens Google Maps at user's location.

**Test sentences**:
- "show my location"
- "open Google Maps"
- "show me on the map"
- "where am I on the map"

**Expected response**:
```xml
<link href="https://www.google.com/maps/place/{{lat}},{{lon}}">Opening your location on map</link>
```

---

### Navigation
**Purpose**: Provides directions to destination.

**Test sentences**:
- "navigate to Berlin"
- "take me to the airport"
- "directions to the hospital"
- "let's go there" (after mentioning a place)

**Expected response**:
```xml
<link href="https://www.google.com/maps/dir/{{lat}},{{lon}}/Berlin">Navigation started to Berlin</link>
```

---

### Hotel Search
**Purpose**: Searches for hotels on Hotels.com.

**Test sentences**:
- "find a hotel"
- "search for hotels in Berlin"
- "where can I stay in Paris"

**Expected response**:
```xml
<link href="https://www.hotels.com/Hotel-Search?destination=Berlin">Searching for hotels in Berlin</link>
```

---

### YouTube Search
**Purpose**: Searches for music/videos on YouTube.

**Test sentences**:
- "play Bohemian Rhapsody"
- "show me tutorial on how to tie a tie"
- "find Coldplay live concert"

**Expected response**:
```xml
<link href="https://www.youtube.com/results?search_query=bohemian+rhapsody">Playing Bohemian Rhapsody</link>
```

---

## Special Tags

### silence
**Purpose**: Indicates no meaningful input detected.

**Test sentences**:
- "..." (transcription error)
- "abone ol" (Turkish artifact)
- "Altyazı M." (subtitle watermark)

**Expected response**:
```xml
<silence/>
```

---

### topic
**Purpose**: Categorizes conversational responses (no XML in response).

**Test sentences**:
- "what is a firewall"
- "how far is Berlin from Paris"
- "who won the world cup in 2014"

**Expected response**:
```
It monitors and controls network traffic based on security rules. <topic title="Firewall Explanation" category="Information" tags="factual" />
```

**Should NOT include topic when**:
- Using any `<action>` tag
- Using any `<link>` tag
- Using `<silence/>`

---

## Test Checklist

- [ ] All search tools trigger correctly
- [ ] Image-search triggers automatically for "who is" questions
- [ ] POI-search returns distances in proper format
- [ ] Flight-search converts USD to local currency
- [ ] Currency-convert triggers after flight-search
- [ ] Take-note uses 3-word title format
- [ ] End-session doesn't trigger on "let's go"
- [ ] Links have spoken text inside tags
- [ ] Topic tags only on non-tool responses
- [ ] System reminders get `<silence/>` response
- [ ] Transcription errors get `<silence/>` response
- [ ] Distance rounding works (751m → "seven hundred fifty meters")
- [ ] No plane models mentioned in flight responses
- [ ] No professional disclaimers ("consult a doctor", etc.)
