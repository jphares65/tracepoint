import re,os,sys,collections
root=sys.argv[1]
cls=collections.Counter(); total=0; iconless=[]
for dp,dn,fn in os.walk(root):
    if '/api' in dp: continue
    for f in fn:
        if not f.endswith('.tsx'): continue
        p=os.path.join(dp,f); s=open(p,encoding='utf-8',errors='ignore').read()
        for m in re.finditer(r'<button\b((?:=>|[^>])*?)>(.*?)</button>',s,re.S):
            total+=1
            attrs=m.group(1)
            c=re.search(r'className=(?:"([^"]*)"|\{`([^`]*)`)',attrs,re.S)
            if c:
                v=(c.group(1) or c.group(2) or '')
                v=re.sub(r'\$\{[^}]*\}','',v)
                cls[' '.join(sorted(v.split()))]+=1
            body=m.group(2)
            text=re.sub(r'<[^>]*>','',body)
            text=re.sub(r'\{[^}]*\}','',text).strip()
            if not text and 'aria-label' not in attrs and 'title=' not in attrs and '{' not in re.sub(r'<[^>]*>','',body):
                ln=s[:m.start()].count('\n')+1
                iconless.append(f"{p.replace(root,'')}:{ln}")
print("buttons",total,"distinct classNames",len(cls))
print("icon-only w/o aria-label/title",len(iconless))
for x in iconless[:40]: print(x)
small=sum(n for k,n in cls.items() if re.search(r'(^| )(py-0\.5|py-1|py-1\.5|p-1|p-1\.5)( |$)',k) and not re.search(r'(^| )(min-h-|h-1[0-9]|h-9|h-10|h-11)',k))
print("buttons with py-0.5/1/1.5 or p-1/1.5 and no min-h:",small)
mid=sum(n for k,n in cls.items() if re.search(r'(^| )(py-2|p-2)( |$)',k) and not re.search(r'min-h-',k))
big=sum(n for k,n in cls.items() if re.search(r'(^| )(py-2\.5|py-3|py-3\.5|py-4|p-3|p-4|min-h-1[0-2]|h-1[0-2])( |$)',k))
print("py-2/p-2 (~32-36px):",mid," >=py-2.5:",big)
