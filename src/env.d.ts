/// <reference types="astro/client" />

import type { JSX as PreactJSX } from "preact";

declare global {
  namespace JSX {
    type Element = PreactJSX.Element;
    interface IntrinsicAttributes extends PreactJSX.IntrinsicAttributes {}
    interface IntrinsicElements {
      a: PreactJSX.IntrinsicElements["a"];
      article: PreactJSX.IntrinsicElements["article"];
      button: PreactJSX.IntrinsicElements["button"];
      caption: PreactJSX.IntrinsicElements["caption"];
      circle: PreactJSX.IntrinsicElements["circle"];
      desc: PreactJSX.IntrinsicElements["desc"];
      dd: PreactJSX.IntrinsicElements["dd"];
      details: PreactJSX.IntrinsicElements["details"];
      div: PreactJSX.IntrinsicElements["div"];
      dl: PreactJSX.IntrinsicElements["dl"];
      dt: PreactJSX.IntrinsicElements["dt"];
      fieldset: PreactJSX.IntrinsicElements["fieldset"];
      figcaption: PreactJSX.IntrinsicElements["figcaption"];
      figure: PreactJSX.IntrinsicElements["figure"];
      form: PreactJSX.IntrinsicElements["form"];
      g: PreactJSX.IntrinsicElements["g"];
      header: PreactJSX.IntrinsicElements["header"];
      h2: PreactJSX.IntrinsicElements["h2"];
      h3: PreactJSX.IntrinsicElements["h3"];
      h4: PreactJSX.IntrinsicElements["h4"];
      h5: PreactJSX.IntrinsicElements["h5"];
      input: PreactJSX.IntrinsicElements["input"];
      label: PreactJSX.IntrinsicElements["label"];
      legend: PreactJSX.IntrinsicElements["legend"];
      li: PreactJSX.IntrinsicElements["li"];
      line: PreactJSX.IntrinsicElements["line"];
      nav: PreactJSX.IntrinsicElements["nav"];
      ol: PreactJSX.IntrinsicElements["ol"];
      option: PreactJSX.IntrinsicElements["option"];
      p: PreactJSX.IntrinsicElements["p"];
      path: PreactJSX.IntrinsicElements["path"];
      polygon: PreactJSX.IntrinsicElements["polygon"];
      polyline: PreactJSX.IntrinsicElements["polyline"];
      rect: PreactJSX.IntrinsicElements["rect"];
      section: PreactJSX.IntrinsicElements["section"];
      select: PreactJSX.IntrinsicElements["select"];
      span: PreactJSX.IntrinsicElements["span"];
      strong: PreactJSX.IntrinsicElements["strong"];
      summary: PreactJSX.IntrinsicElements["summary"];
      svg: PreactJSX.IntrinsicElements["svg"];
      table: PreactJSX.IntrinsicElements["table"];
      tbody: PreactJSX.IntrinsicElements["tbody"];
      td: PreactJSX.IntrinsicElements["td"];
      text: PreactJSX.IntrinsicElements["text"];
      th: PreactJSX.IntrinsicElements["th"];
      thead: PreactJSX.IntrinsicElements["thead"];
      title: PreactJSX.IntrinsicElements["title"];
      tr: PreactJSX.IntrinsicElements["tr"];
      ul: PreactJSX.IntrinsicElements["ul"];
    }
  }
}
