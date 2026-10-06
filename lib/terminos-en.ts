/**
 * Courtesy translation (English) of the Terms and Conditions. The Spanish text in `terminos.ts` is the
 * authoritative, versioned one; this file must keep the same clause ids and the same number of
 * paragraphs per clause (`terminos-i18n.test.ts` enforces it).
 */
import type { Clausula } from './terminos';

export const PREAMBULO_EN: string[] = [
  'These Terms and Conditions (the “Terms”) comprehensively, completely and bindingly govern the relationship between VTuberDex (the “Project”, “we” or “the Maintainer”) and any natural or legal person who, by any means, requests the registration of a VTuber card in the catalog, requests its removal, visits the site, interacts with it or uses any of its features (the “Holder”, “the User” or “you”).',
  'Please read this document in full before submitting any form. Submitting a registration or removal form means full, express, informed and unreserved acceptance of each and every clause that follows, including those that limit rights, set deadlines, establish consequences or exclude liability.',
];

export const CLAUSULAS_EN: Clausula[] = [
  {
    id: 'definiciones',
    titulo: 'First. Definitions and interpretation',
    parrafos: [
      '1.1. “Catalog”: the set of VTuber cards published and searchable on the site, including their cards, images, texts, attributes, links and metadata.',
      '1.2. “Card”: the individual record of a VTuber within the Catalog, with all the public presentation data that make it up.',
      '1.3. “Public Data”: the artistic and presentation data of the VTuber intended to be shown on the Card, such as stage name, tagline, description, country, languages, brand color, character image and links to professional channels and social networks.',
      '1.4. “Personal Data”: any information that identifies or makes identifiable a natural person and that is provided in the forms on a confidential basis, including, without limitation, the email address and the means of verifying ownership.',
      '1.5. “Request”: any submission made through the registration form or the removal form.',
      '1.6. “Approval”: the discretionary decision of the Maintainer to accept a registration Request, which gives rise to a Card in draft status.',
      '1.7. “Degradation”: the process described in the exit clause, by which the Public Data of a removed Card is progressively and irreversibly altered without the Card being deleted from the Catalog.',
      '1.8. Headings are for guidance only and do not alter the scope of the clauses. The singular includes the plural and vice versa. Whenever the Terms say “included” or “including”, it is always understood as “without limitation”.',
      '1.9. In case of any discrepancy between a summarized explanation, a form help text or an informal communication, and the text of these Terms, the text of these Terms always prevails.',
    ],
  },
  {
    id: 'aceptacion',
    titulo: 'Second. Acceptance, capacity and term',
    parrafos: [
      '2.1. Ticking the acceptance box and submitting the form constitute a declaration of intent equivalent to a handwritten signature and produce all the legal effects of a contract concluded by electronic means.',
      '2.2. The Holder declares to be at least eighteen (18) years old or, if a minor, to have the express, prior and verifiable authorization of their mother, father or legal representative, who shall be jointly and severally bound by these Terms. The Maintainer may at any time require proof of this authorization and suspend the Request until it is provided.',
      '2.3. Anyone submitting a Request on behalf of an agency, a group or a third party declares to have sufficient authority to bind them and is personally liable if they do not.',
      '2.4. These Terms take effect upon acceptance and remain in force while a Card associated with the Holder exists, and even after removal with respect to all clauses that by their nature are meant to survive it, especially those on exit, intellectual property, liability and dispute resolution.',
      '2.5. It is recorded that the Maintainer keeps, together with each Request, the version of the Terms accepted and the date and time of acceptance, as evidence of it.',
    ],
  },
  {
    id: 'proceso',
    titulo: 'Third. Nature of registration and review process',
    parrafos: [
      '3.1. Registration is a mere Request. Submitting it creates no right to appear in the Catalog, to obtain a particular publication date, to hold a particular dex number or to keep a place in the Catalog order.',
      '3.2. Every Request requires confirming the email address provided by means of a single-use code or link sent to that address. For registration and for updating a Card, confirmation comes before filling in the form (the code is valid for 1 hour); for removal, it is confirmed after submitting the form (valid for 24 hours) and, until confirmed, the Request is not reviewed and is deleted after a few days. Once confirmed, the Request stays pending until reviewed by the Maintainer. There is no maximum review period; any times stated in any communication are non-binding estimates and depend on the voluntary availability of those who maintain the Project.',
      '3.3. The Maintainer may approve, reject, leave unanswered, request additional information on or partially approve any Request, at its sole discretion and without any obligation to state a reason. Rejection cannot be challenged and gives no right to compensation.',
      '3.4. Approval creates a Card in draft status. The actual publication of the Card is a later, independent and equally discretionary decision, which may take time or may never happen.',
      '3.5. The Maintainer may correct, complete, shorten, translate, reorder, reword or remove any data in the Request to adapt it to the format, style and editorial criteria of the Catalog, including the choice of image, brand color and associated factions.',
      '3.6. The Holder acknowledges that the Catalog is a collective, editorial work; the Card is not a personal profile under their control but an entry in the Catalog whose final content is decided by the Maintainer.',
      '3.7. Submitting false, incomplete or misleading information, or impersonating another person, entitles the Maintainer to reject the Request or remove the Card at any time, without prejudice to any applicable actions.',
    ],
  },
  {
    id: 'datos-personales',
    titulo: 'Fourth. Personal data: confidentiality and processing',
    parrafos: [
      '4.1. The Personal Data provided in the forms (email address, means of verifying ownership and any other data of a reserved nature) are CONFIDENTIAL. They are not published on the site, not incorporated into any Card, not shown in the Catalog, not included in the public API or the sitemap, and not given to third parties outside the Project.',
      '4.2. Personal Data are stored separately from Public Data, in a different field of the Request, so that the Card creation process reads only the Public Data. Only people with maintainer credentials can access them, and only to review the Request, verify ownership and communicate with the Holder.',
      '4.3. The exclusive purposes of processing are: (a) to assess the Request; (b) to communicate its outcome; (c) to verify that whoever asks for a removal is indeed the Holder; and (d) to keep evidence of acceptance of these Terms. No Personal Data will be used for advertising, commercial or profiling purposes, nor sold, assigned or leased.',
      '4.4. Confidentiality is excepted where a legal rule requires the information to be handed over, or where a competent judicial or administrative authority orders it by reasoned decision. In that case only what is strictly required will be handed over.',
      '4.5. For technical and security reasons, instead of the IP address an irreversible fingerprint of the network from which the form is sent is stored, with the sole purpose of limiting mass submission of Requests. The IP address cannot be reconstructed from it.',
      '4.6. Rejected Requests and already processed removals keep only the Public Data and the record of the decision; the confidential contact is deleted when they are closed. In approved registrations the contact is kept while the Card exists, in order to notify its publication and handle future communications.',
      '4.7. The Holder may at any time request access to, rectification or deletion of their Personal Data by writing through the Project’s contact channels. Deleting Personal Data does not imply deleting the Card, which is governed by the exit clause.',
      '4.8. The Holder is responsible for providing true and current contact details. The Maintainer is not liable for communications not received due to errors in the email provided, spam filters or full mailboxes.',
      '4.9. Despite the reasonable measures adopted, no system is infallible. The Maintainer does not guarantee the absolute inviolability of its systems and is not liable for unauthorized access resulting from third-party attacks that could not be avoided with reasonable diligence, undertaking to report relevant breaches where appropriate.',
      '4.10. While the registration is being filled in, what is written is automatically saved as a draft tied to the confirmed email address, so that the Holder can close the page and resume later with that same email. The draft is seen only by the Maintainer when reviewing the already-submitted Request, is deleted when the registration is submitted and, if not submitted, after sixty (60) days without changes.',
      '4.11. Public Data, unlike Personal Data, are meant for display. A Holder who includes personal data in a public field (for example, in the description or in a link) does so under their sole responsibility and authorizes its publication.',
    ],
  },
  {
    id: 'contenido',
    titulo: 'Fifth. Content provided by the Holder and license',
    parrafos: [
      '5.1. The Holder declares and warrants to be the author or legitimate owner of all texts, images, designs, illustrations, models and other materials they provide, or to hold the necessary licenses and authorizations from the illustrators, modelers, animators and other rights holders involved.',
      '5.2. With the Request, the Holder grants the Project a free, worldwide, non-exclusive license, transferable among those who maintain the Project, sublicensable for the technical purposes of the site, and for the entire legal term of protection of the rights, to store, reproduce, adapt, crop, resize, compress, transform, combine, publicly communicate and make available the Public Data and associated images, in the Catalog, on the holographic card, in its search results and in any present or future format or technology for presenting the Catalog.',
      '5.3. The license expressly includes the right to generate visual derivatives of the image, such as cards, frames, slabs, shine effects, holographic effects, crops, smaller versions and any treatment the Project deems appropriate for presentation.',
      '5.4. The license is irrevocable with respect to backups, historical records and materials already disseminated, and survives removal under the terms of the exit clause.',
      '5.5. The Holder retains the intellectual property of their works. The Project retains ownership of the collective work that is the Catalog, its design, its code, its trademarks, its cards, its databases and its numbering system.',
      '5.6. Unlawful content is not accepted, nor content that infringes third-party rights, or that is discriminatory, violent, pornographic, hateful, contains misleading advertising or malicious links, or breaks the law. The Maintainer may remove it without prior notice.',
      '5.7. If a third party makes a claim against the Project over content contributed by the Holder, the Holder undertakes to hold the Project and those who maintain it harmless, bearing the reasonable costs, fees, fines and compensation that result.',
      '5.8. Links to social networks and channels are the responsibility of their owner. The Maintainer does not control or endorse the content of third-party sites and may remove any link if it considers it harmful to the Project or its users.',
    ],
  },
  {
    id: 'obligaciones',
    titulo: 'Sixth. Obligations of the Holder',
    parrafos: [
      '6.1. To provide truthful, accurate, complete and up-to-date information, and keep it so while the Card exists.',
      '6.2. To refrain from submitting Requests on behalf of other people without their authorization, from submitting duplicate or mass Requests, and from using automated tools to complete the forms.',
      '6.3. Not to try to circumvent the site’s technical limits, not to manipulate the like, experience or level counters, not to try to access restricted areas and not to interfere with the operation of the Project.',
      '6.4. To immediately inform the Maintainer of any error in their Card, any misuse of their identity and any relevant change in their contact details.',
      '6.5. To comply with the rules applicable to their activity, including those of the streaming and social media platforms they use, the Project being unrelated to any sanction those platforms may impose.',
      '6.6. To respect the rights of other registered people, refrain from harassing, defaming or hounding other Holders or those who maintain the Project, and act in good faith in all their communications.',
    ],
  },
  {
    id: 'moderacion',
    titulo: 'Seventh. Editorial powers, moderation and suspension',
    parrafos: [
      '7.1. The Maintainer may, at any time, without prior notice or stating a reason, modify, hide, return to draft, reorder, renumber, merge, rename or change the web address of any Card.',
      '7.2. The dex numbering is internal data of the Catalog. Its assignment, modification or reassignment creates no right to a particular number.',
      '7.3. When the name of a Card changes, the previous address may be kept as an alias, but the Project does not guarantee the permanence of any web address.',
      '7.4. The Maintainer may limit the number of Requests per person, network or period, and discard without reply Requests that appear automated.',
      '7.5. Use of the site may be suspended or limited, wholly or partially, temporarily or permanently, when these Terms are breached, without giving rise to any compensation.',
    ],
  },
  {
    id: 'salida',
    titulo: 'Eighth. Exit clause (removal) and Degradation of the Card',
    parrafos: [
      '8.1. The Holder may request removal at any time through the removal form, accepting these same Terms. Removal requires giving an email address and confirming it with a single-use link or code sent to that address. If that email is the one the Holder provided when registering one or more Cards, removal is applied immediately and without review to the Cards registered with it: they move to degradation grade 1. In any other case (for example, cards added to the Catalog without their own registration) the removal stays pending until reviewed and processed by the Maintainer, who may request additional information to verify ownership.',
      '8.2. REMOVAL DOES NOT MEAN THE CARD IS DELETED. Since the Card is an entry in a collective work and forms part of the order, statistics, facets and numbering of the Catalog, it remains in it after removal. The Holder expressly acknowledges and accepts that there is no right to have the Card deleted as an entry of the Catalog.',
      '8.3. Instead of being deleted, the Card will be subjected to DEGRADATION: a progressive and irreversible alteration of its Public Data, which may include, at the Maintainer’s discretion and in the order and pace it determines, partial or total corruption of texts, replacement of characters with unreadable symbols, loss of sharpness, color and resolution of images, removal of links to channels and social networks, loss of attributes, abilities and statistics, neutralization of the brand color and unlinking of factions, grades and distinctions.',
      '8.4. Degradation aims for the Card to stop representing, identifying or promoting the Holder, without altering the integrity of the Catalog. A degraded Card may remain visible, searchable and numbered, with a deteriorated appearance, and may continue to appear in listings, counts and datasets of the Project.',
      '8.5. Degradation is irreversible. A Holder who leaves cannot demand restoration of the earlier Card, even if they later regret it. A new registration will be treated as a new Request subject to its own review, and will not oblige the Project to recover anything that was degraded.',
      '8.6. The Holder’s Personal Data (email and means of verification) are deleted when the removal is processed, per the personal data clause. What remains is the degraded Card, which contains no Personal Data, because they never formed part of it.',
      '8.7. Backups, historical records, third-party archives and materials already disseminated or downloaded before the removal are not subject to Degradation, and the Project cannot ensure their deletion from external sites or services.',
      '8.8. The Maintainer is not obliged to process the removal within a set time, nor to report the progress of the Degradation, nor to confirm its completion. It may reject the removal if ownership is not proven.',
      '8.9. Whoever controls the mailbox of the email provided when registering the Card may, by that fact alone, irreversibly remove the Card: the Holder is responsible for the security of that email.',
      '8.10. Degradation may also be applied, without any request, to Cards whose Holders seriously breach these Terms or for which it is established that the registration was made without right.',
      '8.11. The Holder declares to have read this clause, to understand its scope and to accept it as an essential condition, without which the Project would not have admitted their registration.',
    ],
  },
  {
    id: 'donaciones',
    titulo: 'Ninth. Donations, premium cards and absence of profit motive',
    parrafos: [
      '9.1. The Project is non-profit. The donation system exists exclusively to help finance the site’s operating costs, such as hosting, database, image storage, domain and tools, and is not a commercial activity, a business, a sale of services or a source of income for its maintainers.',
      '9.2. Donations are voluntary, liberal and gratuitous. They are not a price, consideration, subscription, fee or payment for a service, and create no obligation of performance on the Project, beyond what is expressly stated in these Terms.',
      '9.3. Donations are non-refundable, except for a manifest error in the amount charged by the payment provider, which may be corrected at the donor’s request within a reasonable time.',
      '9.4. A donor does not acquire ownership, shares, voting rights, management rights, exclusivity rights or any preference over the Project, the Catalog or its content.',
      '9.5. As a gesture of appreciation, the Project may grant the Card of a donating VTuber a graded “premium” card, whose grade rises under the terms defined by the Maintainer while the donation continues. The grade, its scale, its calculation, its validity and its presentation are a symbolic and decorative distinction, not a right, and may be modified, suspended or withdrawn at any time.',
      '9.6. The premium card does not guarantee visibility, search position, traffic, followers or any commercial result. Nor does it buy the Card’s permanence or exempt it from these Terms or from the exit clause.',
      '9.7. Any eventual surplus will go to the continuity and improvement of the Project. The Project does not distribute profits or pay its maintainers out of donations.',
      '9.8. Payments are processed by external providers, with their own terms and policies, which the donor must accept independently. The Project does not store card or payment account data.',
      '9.9. Donations are the exclusive tax responsibility of whoever makes them and, where applicable, of whoever receives them under the law. The Project does not issue tax documents unless the law expressly requires it.',
      '9.10. The Holder acknowledges that donations are not a requirement to register, to remain in the Catalog or to request removal.',
    ],
  },
  {
    id: 'likes',
    titulo: 'Tenth. Likes, experience, levels and other site mechanics',
    parrafos: [
      '10.1. “Likes”, experience, levels, grades, statistics and other card attributes are playful mechanics of the site. They may be modified, reset, recalculated or removed at any time, without giving the Holder any right.',
      '10.2. Card attributes may be created or adjusted by the Maintainer using its own criteria and do not constitute an evaluation, ranking, certification or opinion on the professional or personal worth of the VTuber.',
      '10.3. The Project applies technical limits intended to prevent manipulation of the counters, and may void likes or adjust experience it considers irregular.',
    ],
  },
  {
    id: 'disponibilidad',
    titulo: 'Eleventh. Service availability and disclaimer of warranties',
    parrafos: [
      '11.1. The site and the Catalog are offered “as is” and “as available”, without warranty of any kind, express or implied, including those of merchantability, fitness for a particular purpose, accuracy, continuity and absence of errors.',
      '11.2. The Project is maintained voluntarily. It may be interrupted, migrated, reduced, have its functions changed or be closed permanently at any time, with or without notice, without giving rise to compensation.',
      '11.3. Indefinite preservation of data, images or Cards is not guaranteed. The Holder is advised to keep a copy of everything they submit.',
      '11.4. The Maintainer does not guarantee that the information in the Catalog is accurate, complete or up to date, nor that links work or lead to the expected destinations.',
      '11.5. Loading times, device compatibility, availability of the three-dimensional card and graphics performance depend on each person’s equipment and browser, and are not the Project’s responsibility.',
    ],
  },
  {
    id: 'responsabilidad',
    titulo: 'Twelfth. Limitation of liability and indemnity',
    parrafos: [
      '12.1. To the maximum extent permitted by law, the Project and those who maintain it shall not be liable for indirect, consequential, incidental, special or punitive damages, nor for lost profits, lost opportunities, audience, income, reputation or data, arising from the use of or inability to use the site, from registration, non-registration, removal or Degradation.',
      '12.2. Where liability cannot be excluded by law, it shall be limited to the amount actually donated by the Holder to the Project in the twelve (12) months before the event giving rise to it, or to zero if they have not donated.',
      '12.3. The Holder undertakes to hold the Project and those who maintain it harmless against claims, damages, losses, costs and fees arising from breach of these Terms, from the information they provided or from third-party rights it infringes.',
      '12.4. Neither party is liable for failures caused by fortuitous event or force majeure, understood as including, among others, the outage of hosting or database providers, power or network failures, cyberattacks, decisions of authorities and any unforeseeable or irresistible event.',
    ],
  },
  {
    id: 'terceros',
    titulo: 'Thirteenth. Third-party services',
    parrafos: [
      '13.1. The site relies on third-party services for hosting, data and image storage, payment processing and sending communications. These providers may process data under their own policies.',
      '13.2. The Project selects providers with reasonable diligence, but is not liable for their failures, changes in terms, closures or security breaches.',
      '13.3. Data may be stored or processed on servers located outside the Holder’s country of residence. By submitting the Request, the Holder expressly consents to such international transfers, limited to what is technically necessary for the site to operate.',
    ],
  },
  {
    id: 'comunicaciones',
    titulo: 'Fourteenth. Communications and notices',
    parrafos: [
      '14.1. The Project’s communications will be sent to the email address provided in the Request, and are deemed made on the day they are sent, regardless of whether they are read.',
      '14.2. The Holder’s communications must be made through the contact channels published by the Project. Those sent by unofficial means, such as private messages to third parties or comments on social networks, will not be considered received.',
      '14.3. The Maintainer may or may not reply to any communication, and do so at the time it considers appropriate.',
      '14.4. The Holder agrees to receive operational notices related to their Request and their Card. The Project will not send advertising.',
    ],
  },
  {
    id: 'modificaciones',
    titulo: 'Fifteenth. Changes to the Terms',
    parrafos: [
      '15.1. The Maintainer may modify these Terms at any time. The current version is the one published on this page, identified by its date.',
      '15.2. Changes apply from their publication to new Requests. For people already registered, they are deemed accepted if they do not request removal within thirty (30) days following publication of the new version.',
      '15.3. It is the Holder’s responsibility to review this page periodically. The Project is not obliged to notify each change individually.',
      '15.4. When the text is modified, forms opened with the previous version will be rejected until the current Terms are accepted again.',
    ],
  },
  {
    id: 'cesion',
    titulo: 'Sixteenth. Assignment, continuity and succession of the Project',
    parrafos: [
      '16.1. The Project may assign, transfer or hand over, wholly or partly, its rights and obligations under these Terms, including the Catalog, the Cards and the database, to another person, organization or community that continues the Project, with the same commitment to confidentiality of Personal Data.',
      '16.2. The Holder may not assign their position under these Terms or transfer their Card to a third party without the written authorization of the Maintainer.',
      '16.3. If the Project is closed, it may release the Catalog, its images and its public data as an archive, or delete them, at its sole choice. Personal Data will be deleted in any case.',
    ],
  },
  {
    id: 'marcas',
    titulo: 'Seventeenth. Trademarks, names and use of image',
    parrafos: [
      '17.1. The stage names, character images and trademarks of VTubers belong to their respective owners. Their appearance in the Catalog is for informational and recognition purposes and does not imply sponsorship, affiliation or mutual endorsement.',
      '17.2. The name “VTuberDex”, its logo, the card design, the holographic effects and the names of the grades belong to the Project and may not be used without authorization.',
      '17.3. The Holder authorizes the use of their stage name and character image, in the manner described in the content clause, for the operation of the Catalog, its detail pages, its previews on social networks and search engines, and the Project’s informational materials.',
      '17.4. The authorization does not include the use of the Holder’s voice, real face or civil image, which the Project neither requests nor publishes.',
    ],
  },
  {
    id: 'seguridad',
    titulo: 'Eighteenth. Security, acceptable use and conduct on the site',
    parrafos: [
      '18.1. It is forbidden to attempt to breach the site’s security, carry out penetration tests without authorization, mass-extract data by automation, overload the services or introduce malicious code.',
      '18.2. Anyone who discovers a vulnerability must report it responsibly to the Maintainer, refraining from exploiting or disclosing it before it is fixed.',
      '18.3. The Project may record minimal technical usage data (such as the network fingerprint and submission date) to protect the service and prevent abuse.',
      '18.4. Breach of this clause may result in blocking, removal of the Card and legal action.',
    ],
  },
  {
    id: 'cookies',
    titulo: 'Nineteenth. Cookies and local storage',
    parrafos: [
      '19.1. The site uses an anonymous technical cookie to recognize the visitor who gives a like and limit it to one per day. It contains no personal data and is not used for advertising.',
      '19.2. The maintainer uses the browser’s local storage to keep their session. This storage is not used in the public forms.',
      '19.3. By browsing the site, the user accepts the use of these technologies, which they may block from their browser, with the resulting loss of functions.',
    ],
  },
  {
    id: 'conservacion',
    titulo: 'Twentieth. Retention periods',
    parrafos: [
      '20.1. Pending Requests are kept until resolved. Rejected Requests and processed removals keep only the Public Data and the record of the decision, without confidential contact.',
      '20.2. The record of acceptance of the Terms (version, date and time) is kept for as long as it may be needed to prove the relationship.',
      '20.3. The Catalog’s Public Data are kept for as long as the Project exists, even after removal, in the degraded form provided for in the exit clause.',
      '20.4. Backups are renewed according to the provider’s technical policy and may retain data for additional periods, until their natural rotation.',
    ],
  },
  {
    id: 'divisibilidad',
    titulo: 'Twenty-first. Severability, waiver and entire agreement',
    parrafos: [
      '21.1. If any clause is declared void or unenforceable, the others remain fully in force, and the affected clause will be interpreted in the way closest to the original intent that the law allows.',
      '21.2. The Project’s failure or delay in exercising a right is not a waiver of it. No waiver is valid unless in writing.',
      '21.3. These Terms constitute the entire agreement between the parties on their subject matter and replace any prior agreement, communication or promise, oral or written.',
      '21.4. Clauses that by their nature must survive termination of the relationship, especially those on exit, intellectual property, personal data, liability and governing law, remain in force after removal.',
    ],
  },
  {
    id: 'ley',
    titulo: 'Twenty-second. Governing law and dispute resolution',
    parrafos: [
      '22.1. These Terms are governed by the laws of the Republic of Chile, without prejudice to the mandatory data protection and consumer rules of the Holder’s domicile that cannot be waived.',
      '22.2. The parties will try to resolve any dispute amicably, through written communication and good-faith negotiation for a period of thirty (30) calendar days.',
      '22.3. After that period without agreement, the dispute shall be submitted to the ordinary courts of justice with jurisdiction in the city of Santiago de Chile, to whose jurisdiction the parties submit.',
      '22.4. No action arising from these Terms may be brought once one (1) year has elapsed since the event giving rise to it occurred or reasonably should have become known, to the extent the law allows agreeing to that period.',
    ],
  },
  {
    id: 'declaraciones',
    titulo: 'Twenty-third. Final declarations of the Holder',
    parrafos: [
      '23.1. By submitting the Request, the Holder declares that: (a) they have read and understood these Terms in full; (b) they accept all their clauses, and in particular those on data confidentiality, license grant, exit with Degradation, non-profit donations and limitation of liability; (c) the information provided is true; (d) they have the right to grant the licenses described here; and (e) they do so freely and voluntarily.',
      '23.2. The Holder acknowledges that they have had the opportunity to ask questions and request clarifications from the Project before accepting, and that their acceptance has not been conditioned or forced.',
      '23.3. The parties agree that the electronic record of the Request, of the version accepted and of its date and time shall constitute sufficient proof of acceptance of these Terms.',
    ],
  },
];
