"""Tutor adapta
def gemini(prompt, schema, max_tokens=2000):
    key = os.getenv('GEMINI_API_KEY','').strip()
    if not key:raise ValueError('Falta GEMINI_API_KEY en la terminal del servidor.')
    with LOCK:
        today=date.today().isoformat()
        if CALLS[today]>=LIMIT:raise ValueError('Límite local alcanzado; continúa con contenido guardado.')
        CALLS[today]+=1
    payload={'systemInstruction':{'parts':[{'text':SYSTEM}]},
             'contents':[{'role':'user','parts':[{'text':prompt}]}],
             'generationConfig':{'responseMimeType':'application/json',
                                 'responseSchema':schema,'maxOutputTokens':max_tokens}}
    req=urllib.request.Request(
      f'https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent',
      data=json.dumps(payload,ensure_ascii=False).encode('utf-8'),
      headers={'Content-Type':'application/json','x-goog-api-key':key},method='POST')
    try:
        with urllib.request.urlopen(req,timeout=90) as resp:answer=json.load(resp)
    except urllib.error.HTTPError as exc:
        try:detail=json.load(exc).get('error',{}).get('message','')
        except (ValueError,TypeError):detail=''
        if exc.code==429:raise ValueError('Gemini aplicó un límite de solicitudes (429); revisa la cuota del proyecto.')
        raise ValueError(f'Gemini rechazó la solicitud ({exc.code}): {compact(detail,260)}')
    except (TimeoutError,socket.timeout,urllib.error.URLError):
        raise ValueError('Gemini tardó demasiado o se perdió la conexión.')
    try:
        candidate=answer['candidates'][0]
        text=''.join(x.get('text','') for x in candidate['content']['parts'])
        return json.loads(text)
    except (IndexError,KeyError,TypeError,ValueError):
        reason=(answer.get('candidates') or [{}])[0].get('finishReason','desconocido')
        raise ValueError(f'Gemini devolvió una salida incompleta ({reason}). No se guardó progreso.')

