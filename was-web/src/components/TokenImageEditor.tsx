import { Fragment, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { AnalyticsContext } from './AnalyticsContext';
import BusyElement from './BusyElement';
import { ImagePickerForm } from './ImagePickerModal';
import { ProfileContext } from './ProfileContext';
import SpriteImage from './SpriteImage';
import { UserContext } from './UserContext';

import { IImage } from '../data/image';
import { getUserPolicy } from '../data/policy';
import { defaultSpriteGeometry, ISprite, toSpriteGeometryString } from '../data/sprite';
import { hexColours } from '../models/featureColour';

import Button from 'react-bootstrap/Button';

interface ITokenImageEditorProperties {
  adventureId: string;
  altText: string;
  busySettingImage: boolean; // pulled-up state flag
  colour: number | string;
  show: boolean;
  sprites: ISprite[];
  setBusySettingImage: (value: boolean) => void;
  setImageTabTitle: (title: string) => void;
  setSprites: (sprites: ISprite[]) => void;
  handleImageDelete: (image: IImage | undefined) => void;
}

function TokenImageEditor({ 
  adventureId, altText, busySettingImage, colour, show, sprites,
  setBusySettingImage, setImageTabTitle, setSprites, handleImageDelete
}: ITokenImageEditorProperties) {
  const { logError } = useContext(AnalyticsContext);
  const { functionsService } = useContext(UserContext);
  const { profile } = useContext(ProfileContext);
  const maxImages = useMemo(
    () => profile === undefined ? undefined : getUserPolicy(profile.level).images,
    [profile]
  );

  // The current image, if any

  const currentImage = useMemo(() => {
    if (sprites === undefined || sprites.length === 0) {
      return (<p>No image is displayed for this token.</p>);
    }

    const hexColour = typeof(colour) === 'number' ? hexColours[colour as number] : String(colour);
    return (
      <Fragment>
        Current image&nbsp;
        <SpriteImage sprite={sprites[0]} altName={altText} size={128} borderColour={hexColour} />
      </Fragment>
    );
  }, [colour, sprites, altText]);

  // Image picking

  const [activeImage, setActiveImage] = useState<IImage | undefined>(undefined);
  const [imageCount, setImageCount] = useState(0);
  useEffect(
    () => {
      const imageTabTitle = `Images (${imageCount}/${maxImages})`;
      setImageTabTitle(imageTabTitle);
    },
    [imageCount, maxImages, setImageTabTitle]
  );

  // We'll hide "set image" while creating the sprite, since that might take a moment:
  const canSetImage = useMemo(() => activeImage !== undefined, [activeImage]);
  const setImageDisabled = useMemo(() => busySettingImage || !canSetImage, [busySettingImage, canSetImage]);

  const handleDeleteImage = useCallback(
    () => handleImageDelete(activeImage),
    [activeImage, handleImageDelete]
  );

  const handleSetImage = useCallback((image: IImage | undefined) => {
    if (image === undefined) {
      setSprites([]);
      return;
    }

    if (functionsService === undefined) {
      return;
    }

    setBusySettingImage(true);
    functionsService.addSprites(
      adventureId, toSpriteGeometryString(defaultSpriteGeometry), [image.path]
    ).then(s => {
      console.debug(`setting sprite to ${image.path}`);
      setSprites(s.filter(s2 => s2.source === image.path));
      setBusySettingImage(false);
    }).catch(e => {
      logError(`Failed to set sprite to ${image.path}`, e);
      setBusySettingImage(false);
    })
  }, [adventureId, functionsService, logError, setBusySettingImage, setSprites]);

  const handleUseNoImage = useCallback(() => handleSetImage(undefined), [handleSetImage]);
  const handleUseImage = useCallback(() => handleSetImage(activeImage), [activeImage, handleSetImage]);

  return (
    <Fragment>
      <div>
        {currentImage}
      </div>
      <ImagePickerForm show={show} setActiveImage={setActiveImage} setImageCount={setImageCount}
        handleDelete={handleDeleteImage} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
        <Button variant="warning" onClick={handleUseNoImage}>Use no image</Button>
        <Button className="ms-2" variant="primary" onClick={handleUseImage} disabled={setImageDisabled}>
          <BusyElement normal="Use image" busy="Setting image..." isBusy={busySettingImage} />
        </Button>
      </div>
    </Fragment>
  );
}

export default TokenImageEditor;