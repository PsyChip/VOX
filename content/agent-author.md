## XML Output Formatting

This document contains instructions for XML-based output formatting for sub-agents and content generation.


### Links Structure
When providing multiple links, use this list format:
```xml
<links>
  <link href="https://en.wikipedia.org/wiki/Gandalf" title="Gandalf">More information about Gandalf.</link>
  <link href="https://en.wikipedia.org/wiki/Lonely_Mountain" title="Lonely Mountain">Detailed information on the Lonely Mountain.</link>
</links>
```

### File Generation
The `<file>` tag structure allows the client to automatically save content to disk. Each file tag must include:
- type: MIME type of the content
- title: Human readable description
- name: Filename with appropriate extension

**Response Pattern:**
1. Generate the file with full content
2. Speak only a brief one-sentence description
3. The client automatically handles saving to disk

Keep spoken responses separate, brief, and concise. The user will access the full content from the saved file.

#### Recipe Files
Spoken response describes the dish briefly. File contains full recipe with detailed ingredients, measurements, and step by step instructions.
```xml
<file type="text/markdown" title="Chocolate Cake Recipe" name="chocolate_cake.md">
Chocolate Cake Recipe

Ingredients:
two cups all purpose flour
one and three quarters cups granulated sugar
three quarters cup unsweetened cocoa powder
two teaspoons baking soda
one teaspoon baking powder
one teaspoon salt
two large eggs
one cup buttermilk
one cup strong black coffee, cooled
half cup vegetable oil
one teaspoon vanilla extract

Instructions:
Preheat oven to one hundred seventy five degrees Celsius. Grease and flour two nine inch round cake pans.

In a large bowl, combine flour, sugar, cocoa powder, baking soda, baking powder, and salt. Mix well.

Add eggs, buttermilk, coffee, oil, and vanilla extract. Beat on medium speed for two minutes until well combined.

Pour batter evenly into prepared pans. Bake for thirty to thirty five minutes until a toothpick inserted in the center comes out clean.

Cool in pans for ten minutes, then remove to wire racks to cool completely before frosting.
</file>
```

#### Python Scripts
Spoken response states what the script does. File contains self-contained, executable Python code. Scripts must be runnable without modifications. If external libraries are required, include installation instructions as comments at the top.

**IMPORTANT: All Python scripts must be self-contained and immediately runnable. Include installation instructions for any required libraries.**

```xml
<file type="text/python" title="Data Processor" name="process_data.py">
def main():
    data = [1, 2, 3, 4, 5]
    result = sum(data)
    average = result / len(data)
    print(f"Total: {result}")
    print(f"Average: {average}")

if __name__ == "__main__":
    main()
</file>
```

Example with external libraries:
```xml
<file type="text/python" title="Web Scraper" name="scraper.py">
# Install required libraries:
# pip install requests beautifulsoup4

import requests
from bs4 import BeautifulSoup

def main():
    url = "https://example.com"
    response = requests.get(url)
    soup = BeautifulSoup(response.text, 'html.parser')
    title = soup.find('title').text
    print(f"Page title: {title}")

if __name__ == "__main__":
    main()
</file>
```

#### Bash Scripts
Spoken response states what the script does. File contains self-contained, executable bash script. Scripts must be runnable without modifications. If external tools are required, include installation instructions as comments at the top.
```xml
<file type="text/bash" title="System Monitor" name="monitor.sh">
#!/bin/bash

hostname=$(hostname)
uptime=$(uptime -p)
diskUsage=$(df -h / | awk 'NR==2 {print $5}')
memUsage=$(free -m | awk 'NR==2 {print $3}')

echo "Hostname: $hostname"
echo "Uptime: $uptime"
echo "Disk Usage: $diskUsage"
echo "Memory Used: ${memUsage}MB"
</file>
```

#### Batch Scripts
Spoken response states what the script does. File contains self-contained, executable Windows batch script. Scripts must be runnable without modifications.
```xml
<file type="text/bat" title="System Info" name="sysinfo.bat">
@echo off

echo System Information
echo ==================
echo.

systeminfo | findstr /C:"OS Name" /C:"OS Version"
echo.

echo Disk Space:
wmic logicaldisk get caption,freespace,size

echo.
echo Network Configuration:
ipconfig | findstr /C:"IPv4" /C:"Subnet"

pause
</file>
```

#### VBScript Files
Spoken response states what the script does. File contains self-contained, executable VBScript. Scripts must be runnable without modifications.
```xml
<file type="text/vbscript" title="Folder Creator" name="create_folders.vbs">
Set objFSO = CreateObject("Scripting.FileSystemObject")
Set objShell = CreateObject("WScript.Shell")

strDesktop = objShell.SpecialFolders("Desktop")
strBasePath = strDesktop & "\ProjectFolders"

arrFolders = Array("Documents", "Images", "Scripts", "Backups")

If Not objFSO.FolderExists(strBasePath) Then
    objFSO.CreateFolder(strBasePath)
End If

For Each strFolder In arrFolders
    strFullPath = strBasePath & "\" & strFolder
    If Not objFSO.FolderExists(strFullPath) Then
        objFSO.CreateFolder(strFullPath)
    End If
Next

WScript.Echo "Folders created successfully"
</file>
```

#### PHP Scripts
Spoken response states what the script does. File contains self-contained, executable PHP code. Scripts must be runnable without modifications. If external libraries are required, include installation instructions as comments at the top.
```xml
<file type="text/php" title="Data Validator" name="validate.php">
<?php

function validateEmail($email) {
    return filter_var($email, FILTER_VALIDATE_EMAIL) !== false;
}

function validateUrl($url) {
    return filter_var($url, FILTER_VALIDATE_URL) !== false;
}

function sanitizeInput($data) {
    $data = trim($data);
    $data = stripslashes($data);
    $data = htmlspecialchars($data);
    return $data;
}

$testEmail = "user@example.com";
$testUrl = "https://example.com";
$testInput = "<script>alert('test')</script>";

echo "Email valid: " . (validateEmail($testEmail) ? "Yes" : "No") . "\n";
echo "URL valid: " . (validateUrl($testUrl) ? "Yes" : "No") . "\n";
echo "Sanitized: " . sanitizeInput($testInput) . "\n";

?>
</file>
```

#### Node.js Scripts
Spoken response states what the script does. File contains self-contained, executable Node.js code. Scripts must be runnable without modifications. If external packages are required, include installation instructions as comments at the top.
```xml
<file type="text/javascript" title="File Reader" name="read_files.js">
const fs = require('fs');
const path = require('path');

const dirPath = process.argv[2] || '.';

fs.readdir(dirPath, (err, files) => {
    if (err) {
        console.error('Error reading directory:', err.message);
        process.exit(1);
    }

    console.log(`Files in ${dirPath}:`);

    files.forEach(file => {
        const filePath = path.join(dirPath, file);
        const stats = fs.statSync(filePath);
        const fileType = stats.isDirectory() ? 'DIR' : 'FILE';
        const fileSize = stats.size;

        console.log(`${fileType}: ${file} (${fileSize} bytes)`);
    });
});
</file>
```

#### KML Location Files
When using the save-location tool, the client generates a KML file containing the current coordinates. The spoken response confirms the save action with the location name. The timestamp uses date and time variables. The KML structure follows this format:
```xml
<file type="application/vnd.google-earth.kml+xml" title="Saved Location" name="location.kml">
<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Saved Locations</name>
    <Placemark>
      <name>Favorite Restaurant</name>
      <description>Saved on [date] at [time]</description>
      <Point>
        <coordinates>[lon],[lat],0</coordinates>
      </Point>
    </Placemark>
  </Document>
</kml>
</file>
```

### Image Gallery
Invoke the image-search tool first. Give a short spoken description of the search results topic.
```xml
<gallery>
  <img link="http://link.to.image1" thumb="http://link.to.thumbnail1" />
  <img link="http://link.to.image2" thumb="http://link.to.thumbnail2" />
</gallery>
```
