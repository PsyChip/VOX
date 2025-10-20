export function getLocalTime24() {
  const now = new Date();
  return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}
export function detectPerformance() {
  const hasLowMemory = navigator.deviceMemory && navigator.deviceMemory < 8;

  if (hasLowMemory) {
    window.lowEnd = true;
  }

  if (window.location.search.includes('lowend=true') || window.location.search.includes('lowend=verylow')) {
    window.lowEnd = true;
  } else if (window.location.search.includes('lowend=false')) {
    window.lowEnd = false;
  }
}


export function tzOffset() {
  return -new Date().getTimezoneOffset() / 60;
}

export function getDayPhase() {
  const now = new Date();
  const hour = now.getHours();

  if (hour >= 5 && hour < 12) {
    return 'morning';
  } else if (hour >= 12 && hour < 17) {
    return 'day';
  } else if (hour >= 17 && hour < 21) {
    return 'evening';
  } else {
    return 'night';
  }
}
export function isStereoMix(device) {
  const stereoMix = [
    'Stereo Mix',
    'What U Hear',
    'Loopback',
    'VB-Audio Virtual Cable',
    'VB-Audio VoiceMeeter',
    'Virtual Audio Cable',
    'BlackHole',
    'Soundflower',
    'Jack Audio Connection Kit',
    'ASIO4ALL',
    'Rogue Amoeba Loopback',
    'Dante Virtual Soundcard',
    'Sunflower',
    'loopback'
  ];
  const name = (device || '').toString();
  for (let i = 0; i < stereoMix.length; i++) {
    if (name === stereoMix[i] || name.indexOf(stereoMix[i]) > -1 || stereoMix[i].indexOf(name) > -1) {
      return true;
    }
  }
  return false;
}

export function stripXmlTags(text) {
  const regex = /<([a-zA-Z][\w-]*)(\s[^>]*)?>[\s\S]*?<\/\1>|<([a-zA-Z][\w-]*)(\s[^>]*)?\/?>(?![\s\S]*?<\/\3>)/g;
  return text.replace(regex, '').trim();
}

export function xmlToJson(xmlStr) {
  const regex = /<([a-zA-Z][\w-]*)(\s[^>]*)?>[\s\S]*?<\/\1>|<([a-zA-Z][\w-]*)(\s[^>]*)?\/?>(?![\s\S]*?<\/\3>)/g;
  const matches = [...xmlStr.matchAll(regex)];
  if (matches.length === 0) return [];

  const parser = new DOMParser();
  function elementToJson(el) {
    const obj = {};
    const attrs = {};
    for (let i = 0; i < el.attributes.length; i++) {
      const attr = el.attributes[i];
      attrs[attr.name] = attr.value;
    }
    if (Object.keys(attrs).length > 0) obj.attr = attrs;

    if (el.childNodes && el.childNodes.length > 0) {
      let textContent = '';
      for (let i = 0; i < el.childNodes.length; i++) {
        const child = el.childNodes[i];
        if (child.nodeType === 3) {
          textContent += child.nodeValue;
        } else if (child.nodeType === 1) {
          const childObj = elementToJson(child);
          if (!obj.children) obj.children = [];
          obj.children.push(childObj);
        }
      }
      const trimmed = textContent.trim();
      if (trimmed) obj.text = trimmed;
    }

    obj.tag = el.tagName ? el.tagName.toLowerCase() : '';
    return obj;
  }

  const results = [];
  for (const match of matches) {
    let tagMatch = match[0];
    let xmlSnippet = tagMatch;
    if (tagMatch && !xmlSnippet.endsWith('/>') && !xmlSnippet.includes('</')) {
      xmlSnippet = xmlSnippet.replace(/>$/, '/>');
    }
    const xmlDoc = parser.parseFromString(xmlSnippet, 'text/xml');
    const parseError = xmlDoc.querySelector('parsererror');
    if (!parseError) {
      const jsonResult = elementToJson(xmlDoc.documentElement);
      results.push(jsonResult);
    }
  }

  return results.length === 1 ? results[0] : results;
}
