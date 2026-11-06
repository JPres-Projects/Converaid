# Meetingly-Fork – Implementierungsauftrag: kompakte Antworten in vollständigen Sätzen

## Ziel
Die von Meetingly erzeugten Antworten sollen **direkt vorlesbar, fachlich korrekt und auch ohne Spezialwissen verständlich** sein. Der Nutzer kann scrollen; deshalb ist Klarheit wichtiger als eine künstlich extrem kurze Ausgabe. Gleichzeitig soll **kein unnötiger Text** entstehen. Die Antworttiefe richtet sich nach der konkreten Frage, nicht nach einer festgelegten Satz- oder Wortzahl.

## Problem im aktuellen Verhalten
Im bestehenden Meetingly-Code enthält `app/shared/types.ts` eine globale Formatvorgabe namens `ANSWER_FORMAT`. Sie verlangt aktuell eine fettgedruckte Kernaussage gefolgt von 2–4 Stichwortfragmenten und enthält ausdrücklich `not a sentence`. Solche Fragmente sind bei unbekannten Fachbegriffen schwer zu verstehen und nicht ohne gedankliche Ergänzung vorlesbar. Auch Vorgaben in `ANSWER_LENGTHS` sowie weitere Prompt-Bausteine dürfen nicht wieder widersprüchliche Kürzungsregeln einführen.

## Implementierungsumfang
1. Ersetze die stichwortorientierte Vorgabe durch einen verbindlichen Antwortstil mit **vollständigen, grammatikalisch korrekten Sätzen**. Keine abgehackten Stichwortfolgen, keine Telegramm-Sprache.
2. **Direkte Antwort zuerst**, danach nur die Erklärung, die nötig ist, damit jemand ohne tiefes Vorwissen den Gedanken versteht. Fachbegriffe bei Bedarf unmittelbar und knapp erklären.
3. **Dynamische Länge statt Hardcoding:** Einfache Fragen kurz beantworten; bei komplexen Fragen ausreichend erklären. Keine festen Limits wie „immer 3–5 Sätze“, „maximal 100 Wörter“ oder „immer vier Bulletpoints“.
4. Normale Ausgabe möglichst als kurze, gut lesbare Absätze. Aufzählungen nur, wenn die Frage wirklich eine Liste oder mehrere klar getrennte Schritte verlangt; dann vollständige, verständliche Sätze statt Stichwortfragmente.
5. Bei Coding-Fragen nur dann Code, Pseudocode oder ein Beispiel liefern, wenn das zum Verständnis oder zur Aufgabenstellung erforderlich ist. Keine langen Standard-Einleitungen, keine Füllwörter und keine Wiederholung der Frage.
6. Bei Fragen zu eigenen Projekten oder Erfahrungen **keine technischen Details, Leistungen oder Zuständigkeiten erfinden**. Nur bereitgestellten/verifizierten Kontext verwenden; Wissenslücken offen benennen und nicht mit plausibel klingenden Behauptungen füllen.
7. Wende die Formatvorgabe **konsistent auf alle Antwortwege** an: manuelles „Answer“, Auto-answer, Chat sowie Antworten nach Bildschirmanalyse, soweit diese denselben Antwortgenerator nutzen. Transkriptions- und UI-Funktionen nicht unnötig verändern.
8. Die bisherigen Optionen für Antwortlänge dürfen bestehen bleiben; sie sollen nur die **Detailtiefe** beeinflussen, niemals wieder Satzfragmente erzwingen.

## Vorgeschlagener System-/Format-Prompt (Englisch)

> Give the direct answer first, using natural, complete, grammatically correct sentences that the user can understand and read aloud without having to fill in missing words. Be concise but not cryptic: explain the key reasoning and unfamiliar technical terms in plain language when needed. Adjust depth to the question's complexity; never follow a fixed number of sentences, bullets, or words. Prefer short, readable paragraphs. Avoid bullet-point fragments, filler, generic introductions, repetition, and unnecessary caveats. Use a list or code only when it genuinely helps answer the question, and make list items complete and meaningful. For questions about personal projects, experience, or responsibilities, rely only on supplied, verified context; do not invent facts or claim work the user has not confirmed.

## Beispiel für die gewünschte Ausgabe
**Frage:** “What is SQL injection, and how do you prevent it?”

**Gewünschte Antwort:** “SQL injection happens when an application inserts untrusted user input directly into a database query, allowing an attacker to change what the query does. This can expose or modify data. Parameterized queries prevent user input from being interpreted as SQL code, and restricted database permissions limit potential damage.”

**Nicht gewünscht:** “Input manipulation. Data theft. Prepared statements. Least privilege.”

## Prüfung / Abnahmekriterien
- Teste mindestens eine einfache Fachfrage, eine mehrteilige Coding-Frage, eine Erklärung für Nicht-Experten und eine Frage zu persönlichen Projekten.
- Antworten sind grammatikalisch vollständig, unmittelbar verständlich, ohne Stichwortfragmente und ohne unnötige Länge.
- Einfache Fragen bleiben kurz; schwierige Fragen bekommen genug Erklärung. Keine festen Satzlimits.
- Die Regel gilt für **manuelle und automatische** Antworten sowie für Bildschirminhalte, soweit deren Ausgabe denselben Formatierungsweg nutzt.
- Bestehende Funktionen, API-Anbindung, Modellwahl, Streaming und Tastenkürzel bleiben erhalten.
- Implementiere im **bereits vorhandenen Fork**, ohne ein neues Repository anzulegen. Dokumentiere die geänderten Dateien und teste die relevanten Antwortpfade.
