## Jellyfin-Qualitytags

this is a repo for the modification of jellyfin webui that gives you quality tags over your posters and thumbnails (UHD SD HD)

> [!WARNING]
> confirmed working on 10.11.0

## How to use?

### Method 1

it is simple to install so simply go to your webroot typically /usr/share/jellyfin/web on linux (windows is another dir but same idea) and edit your index.html

add the following before the </body> tag

`<script defer src="qualitytags.js"></script>`

save and close the editor

now drop the qualitytags.js file into your webroot

reload your client (again you need to clear your cache you can either google how to do this on your specific browser or you can use web developer mode by right clicking and then clicking inspect and then go to the network tab and check disable cache then reload the page)

### Method 2
- Install the **Tampermonkey** extension suitable for your browser:  
    [Chrome](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo?pli=1) | [Firefox](https://addons.mozilla.org/zh-CN/firefox/addon/tampermonkey/?utm_source=addons.mozilla.org&utm_medium=referral&utm_content=search) | [Edge](https://microsoftedge.microsoft.com/addons)


- Install the script from Greasy Fork:  
    [Script Link](https://greasyfork.org/en/scripts/557395-jellyfin-%E6%B5%B7%E6%8A%A5%E5%9B%BE%E6%B7%BB%E5%8A%A0%E5%88%86%E8%BE%A8%E7%8E%87%E6%A0%87%E8%AF%86-jellyfin-qualitytags?locale_override=1)


-  Refresh your Jellyfin page to check if it has taken effect. If not, please configure it as follows:
    [ Permission to execute userscripts](https://www.tampermonkey.net/faq.php?version=5.4.1&ext=dhdg#Q209)


## Screenshots

  

![Screenshot 2025-05-24 150125](https://github.com/user-attachments/assets/e5d8a7c8-89ff-4983-a106-93d9e9edfae0)

![Screenshot 2025-05-24 150328](https://github.com/user-attachments/assets/aed606ce-356d-49a9-8ba3-f8b3cbb5b4dc)

![Screenshot 2025-05-24 150605](https://github.com/user-attachments/assets/fd1a7127-f6ca-4509-b431-5234a066ec81)