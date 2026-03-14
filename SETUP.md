# 🎤 KARAOKE PARTY — Guia de Instalação

Deploy em ~8 minutos. Zero custos. Sem cartão.

---

## STACK

| Serviço | Para quê | Custo |
|---------|----------|-------|
| **Firebase Realtime DB** | Salas ao vivo, fila, chat | Grátis (1GB, 10GB/mês transfer) |
| **Vercel** | Hosting do site estático | Grátis para sempre |
| **LRCLIB** | Letras sincronizadas | Grátis, open-source |
| **YouTube IFrame API** | Player de música | Grátis |

---

## PASSO 1 — Criar projeto Firebase (5 min)

1. Vai a **https://console.firebase.google.com**
2. Clica **"Adicionar projeto"** → dá um nome (ex: `karaoke-party`)
3. Desativa Google Analytics (não precisas) → **Criar projeto**
4. No menu lateral, clica **"Realtime Database"**
5. Clica **"Criar base de dados"**
   - Escolhe **região** (Europe West é o mais próximo)
   - Seleciona **"Começar em modo de teste"** → Ativar
6. No menu lateral, clica **"Visão geral do projeto"** (ícone ⚙️ engrenagem)
7. Clica em **"</> Web"** para registar uma app web
   - Dá um nome (ex: `karaoke-web`) → Registar app
   - **Copia o objeto `firebaseConfig`** que aparece — parece isto:
     ```json
     {
       "apiKey": "AIzaSy...",
       "authDomain": "karaoke-party-xxxx.firebaseapp.com",
       "databaseURL": "https://karaoke-party-xxxx-default-rtdb.europe-west1.firebasedatabase.app",
       "projectId": "karaoke-party-xxxx",
       "storageBucket": "karaoke-party-xxxx.appspot.com",
       "messagingSenderId": "123456789",
       "appId": "1:123456789:web:abcdef"
     }
     ```

8. Vai a **Realtime Database → Regras** e substitui pelo conteúdo de `firebase-rules.json`
   → Clica **Publicar**

---

## PASSO 2 — Deploy no Vercel (3 min)

### Opção A: Upload direto (mais rápido)
1. Vai a **https://vercel.com** → cria conta grátis
2. Clica **"Add New → Project"**
3. Escolhe **"Browse"** e faz upload desta pasta
4. Clica **Deploy** → aguarda ~30 segundos

### Opção B: Via GitHub
1. Cria repositório no GitHub, faz upload dos ficheiros
2. No Vercel → **Import Git Repository** → Deploy

---

## PASSO 3 — Configurar no browser

Quando abrires o site pela primeira vez aparece um modal a pedir o Firebase Config.

1. Cola o JSON que copiaste no Passo 1 (o objeto `firebaseConfig` inteiro)
2. Clica **"Guardar e Continuar"**

✅ Feito! O JSON fica guardado no `localStorage` do teu browser.

> **Dica para facilitar a vida dos amigos:** Podes hardcodar as credenciais diretamente no `js/app.js`:
> ```js
> // No início do ficheiro, em vez do modal, adiciona:
> const FIREBASE_CFG = { apiKey: "...", databaseURL: "...", ... };
> ```
> E em `window.addEventListener('fb-ready', ...)` substitui o `JSON.parse(raw)` por `FIREBASE_CFG`.

---

## COMO JOGAR

1. **Host** cria uma sala → recebe código de 6 letras (ex: `KRTX42`)
2. **Amigos** abrem o site → "Entrar numa Sala" → metem o código
3. Qualquer pessoa pode **pesquisar músicas** e adicionar à fila
4. Quando é a tua vez, as letras aparecem e destacam em tempo real 🟡
5. Podes adicionar um **link YouTube** para a música tocar ao mesmo tempo
6. Clica **✅ Terminei!** quando acabar → próxima pessoa na fila

---

## LIMITES DO PLANO GRATUITO FIREBASE

- **1 GB** de dados armazenados
- **10 GB/mês** de transferência
- **100 conexões simultâneas**

Para festas de amigos: **mais do que suficiente**. 🎉

---

## PROBLEMAS COMUNS

**"Sala não encontrada"**
→ O código é case-insensitive mas confere se tem 6 caracteres

**Letras não aparecem**
→ Tenta pesquisar em inglês ou com o nome do artista

**Vídeo YouTube não toca**
→ Alguns vídeos bloqueiam embed — procura versão "karaoke" ou "backing track"

**Modal Firebase aparece sempre**
→ Confirma que o JSON tem a chave `databaseURL`

---

Boa festa! 🎤🔥
